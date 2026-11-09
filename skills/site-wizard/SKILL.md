---
name: site-wizard
description: "Start here. Set up a project for the Website Builder Toolkit: find out what the user wants to do (full website, design only, copy only, build without branding and copy, anti-slop check, or design tool first), check what the project already has, ask the open questions one at a time with a recommendation, write website-builder/setup.md and hand over to the first skill. Use when the user says wizard, start, setup, or doesn't know which skill to use."
license: CC-BY-4.0
disable-model-invocation: true
---

# Site wizard

Sets the scope before any work starts, so each skill knows what is in and what is out. It explores, asks, writes one small config file, and hands over. It does not design or write copy itself.

Every skill can also be started on its own (for example `site-copy` for text only, `site-audit` for an anti-slop check). The wizard is for when the scope isn't clear yet or several skills are needed.

## 1. Explore first

Look before asking. Report what you found in a few lines:

- `website-builder/setup.md` already present? Then show it and ask only what changed.
- `website-builder/brand.md` (or a brand guide, style sheet, approved texts) present?
- Stack: Automatic.css loaded (stylesheet, plugin, `automatic.css` in uploads)? Etch or Bricks in use (plugins, connector config, theme)? Tailwind or plain CSS?
- Language of existing content.
- Design files mentioned or linked (Figma, Paper, Pencil)?

## 2. Ask, one section at a time

Lead each section with the recommended answer so the user can accept it with a word. Skip a section when exploration already settled it.

**A. What do you want to do?**

| Mode | What runs | Brand needed |
| --- | --- | --- |
| **Full website** | `site-brand` → `site-direction` → `site-design` with `site-copy` → `site-polish` → `site-verify` | yes |
| **Design only** | `site-direction` → `site-design` → `site-polish` → `site-verify`; copy stays as it is | yes, or neutral |
| **Copy only** | `site-copy` → lint from `site-audit` → `site-verify` (content checks) | voice and facts |
| **Build only** (no branding, no copy) | neutral tokens, structure and components with `site-design` passes 1–3 and 5–9, marked placeholders for text, `site-verify` | no |
| **Anti-slop check** | `site-audit`; then optionally `site-direction` → `site-design` → `site-verify` | helpful, not required |
| **Design tool first** | `site-brand` → `site-direction` → frames with `site-handoff` → build → compare → `site-verify` | yes |

Where a flow runs `site-verify`, run `site-accessibility` with it before handing over.

**B. Brand.** Use the existing `website-builder/brand.md` / import existing guidelines with `site-brand` / interview with `site-brand` / none (neutral). Recommend import when material exists, interview when nothing exists, none only for build-only mode.

**C. Stack.** CSS framework: Automatic.css / Tailwind / plain CSS / none. Builder: Etch / Bricks / other / none. Load `site-acss`, `site-etch`, `site-bricks` only for what is in use. Ask for the build tooling the project already uses (for Etch, for example, the Etch connector or Kevin Geary's toolkit); this toolkit doesn't write into builders by itself.

**D. Language** of the copy: German, English, other.

**E. Pages or pieces** in this run, in order. Recommend one page or one section per session.

**F. Where the project data lives.** All files from this toolkit go into one folder named `website-builder/`, so their origin is clear and they don't collide with the project's own folders. Recommend:
- a code project (static site, app, theme): `website-builder/` in the repository root;
- a WordPress site edited through a builder (Etch, Bricks): a local working folder per site, for example `<workspace>/projects/<site>/website-builder/`, because the site itself has no local repository.

**G. Out of scope** for this run (for example SEO texts, legal pages, images). Recorded so no skill drifts into it.

## 3. Write `website-builder/setup.md`

Create the data folder if it doesn't exist:

```
website-builder/
  setup.md                      this file: mode, brand, stack, language, scope
  brand.md                      brand profile (site-brand)
  direction/<page>.md           confirmed direction and skeleton (site-direction)
  audits/<date>-<page>.md       anti-slop findings (site-audit)
  handoff/<page>.md             design tool to code (site-handoff)
  reports/<date>-<page>.md      verification reports (site-verify)
  screenshots/<date>-<page>/    evidence at real size; keep out of git
```

`setup.md`:

```markdown
---
mode: full | design | copy | build | audit | design-tool
brand: brand.md | none
framework: acss | tailwind | plain | none
builder: etch | bricks | other | none
design_tool: figma | paper | pencil | none
language: de | en
---

# Website Builder setup

- Data folder: …
- Pieces in this run: …
- Out of scope: …
- Build tooling: …
- Decided on: YYYY-MM-DD, by: …
```

Every skill reads this file first when it exists. In mode `build` or with `brand: none`, skills use neutral tokens (`plain-css.md` in `site-design`) and mark every text as a placeholder like `[TEXT: headline about …]`; they never invent brand values or copy.

## 4. Hand over

Name the first skill and start it, with the first piece from section E. After each skill, say what comes next in the chosen mode and wait for the user to continue.

## Prohibitions

- Do not ask what you can find out yourself.
- Do not ask all sections at once; one section, one answer.
- Do not start designing or writing inside the wizard.
- Do not overwrite an existing `website-builder/setup.md` or `website-builder/brand.md` without showing the change first.
