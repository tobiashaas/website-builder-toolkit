# German copy: tells and conventions

Load this when the copy is German. The brand profile decides address form and gendering; this file lists what reads as generated in German and how to fix it. Lint: `node <site-audit>/scripts/slop-lint.mjs <paths> --lang de`.

## Address and register

- Use the profile's `address`, and `address_overrides` for areas with another form (for example `karriere/**` → du); slop-lint applies the override per file path. B2B usually takes **Sie**, recruiting and youth often **du**. Never mix within one piece.
- `gendering` comes from the profile: `none` means classic forms only (Kunden, Mitarbeiter), no colon, star or underscore forms. Other values: apply consistently or not at all.

## Phrases that read as generated

| Tell | Fix |
| --- | --- |
| „In der heutigen schnelllebigen Welt …“ | start with the fact |
| „Tauchen Sie ein in …“, „Entdecken Sie …“ | say what the reader finds or does |
| „Mehr als nur …“ | say what it is |
| „nicht nur … sondern auch …“, „Kein X, sondern Y“ | state the positive claim; a contrast only when the contrast is the information |
| „Ihr Partner für …“, „Ihr kompetenter Ansprechpartner“ | name the person, place or service |
| „ganzheitlich“, „maßgeschneidert“, „innovativ“ without the concrete thing | list the parts, name what was adapted, name the innovation |
| „revolutionär“, „bahnbrechend“, „einzigartig“, „perfekt“, „optimal“, „next level“ | delete or replace with a checkable fact |
| „Wir freuen uns auf Ihre Anfrage!“ | a concrete next step: who calls back, what to bring |
| Staccato: „Schnell. Einfach. Sicher.“ | one full sentence with a reason |
| Rhetorical questions in body copy („Kennen Sie das?“) | state the situation |
| Exclamation marks | none outside of real warnings |

## Typography

- Quotation marks „…“ and ‚…‘, not "…".
- Ellipsis …, dashes with spaces – as Gedankenstrich, en dash for ranges 8–17 Uhr.
- Numbers: 1.000 for thousands, 12,5 % with a thin or normal space before %, dates 07.11.2026 or 7. November 2026.
- Units with a space: 16 px, 4,5:1.
- No trailing period on buttons and labels.

## Checks before handing over

1. Read every headline against a competitor's name. If it still fits, use the brand's nouns.
2. Every number has a source in the profile's facts.
3. No promise from `claims_never` (response times, guarantees, „100 %“).
4. Sie/du consistent, gendering as profiled.
5. Lint passes with `--lang de --brand <profile>`.
