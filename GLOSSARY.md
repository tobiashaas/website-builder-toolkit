# Glossary

Terms the toolkit's skills share. Use them as defined; flag a new meaning instead of stretching an old one.

**Data folder**
`website-builder/` in the project (or in a local working folder for builder sites): setup, brand profile, directions, audits, handoffs, reports, screenshots.

**Source of truth**
Where a brand's binding rules live when that is not `brand.md` itself (a wiki, an Obsidian vault, a design system). The profile then is a generated copy that `site-brand` checks against the source before use.

**Setup file**
The project's `website-builder/setup.md`, written by `site-wizard`: mode, brand, stack, language, pieces in this run, what is out of scope. Every skill reads it first.

**Mode**
What a run covers: full website, design only, copy only, build only (no branding, no copy), anti-slop check, or design tool first.

**Placeholder**
Marked stand-in text like `[TEXT: headline about …]`, used when copy is out of scope or no brand exists. Never invented copy that looks final.

**Brand profile**
The project's `website-builder/brand.md`, created with `site-brand` from the template. The single source of truth for colors, type, shape, imagery, motion stance, voice, banned words, facts and claims never to make.
_Avoid_: style guide (an input to the profile, not the profile), brand book

**Tell**
A sign that a piece was generated or not designed: a purple gradient, an emoji icon, a hype word, a three-card grid. Listed with its fix in `slop-signs.md` (site-audit).
_Avoid_: slop (fine in conversation, not as a finding label)

**Page type**
What a page is for, chosen by the reader's intent: offer, product, guide, glossary, case study, location, help, news, landing page. One type, one job, one main search term per page.

**Pillar, cluster, leading page**
Pillar: top topic with a real hub page. Cluster: a group of at least three pages inside a pillar, led by one leading page. Navigation, breadcrumbs and sibling links follow from these levels.

**Direction**
Five lines (offer, character, world, moment, signature) plus one concept sentence, written by `site-direction` and confirmed by a person before styling starts.

**Concept**
The one sentence in the direction every later choice is checked against. It must survive the next state and rule something out.

**World**
The place, material or work a brand belongs to. Neutrals and accent are derived from it. It does not have to appear as a picture.

**Skeleton**
Sections, components and tokens in use, written with the direction and confirmed with it.

**Pass**
One step of `site-design` (spacing, color, icons, copy, type, layout, details, moment, motion), finished across the whole piece and checked before the next.

**Moment**
The one place a piece spends its richness, so it isn't a template. Behaviour, real content, proportion, type or an object from the world.

**Signature**
One small detail only this brand uses, consistently. Optional, and exempt from subtraction.

**Stack skill**
`site-acss`, `site-etch`, `site-bricks`: map the passes to one framework or builder. Loaded only when the project uses it.

**Fresh reviewer**
A person, or an agent with no context and only the render and the score table, who gives the score. The author never scores their own work.

**Render**
The piece as people will see it, at the size they will see it: the frontend, an exported frame, a social preview. Not the code, not the builder canvas.

## Relationships

- A **brand profile** feeds every **direction**.
- A **direction** contains one **concept** and points at one **moment** and optionally a **signature**.
- **Passes** run after the **direction** is confirmed; each ends with a check on the **render**.
- **Tells** are found by `site-audit` and fixed in **passes**.
