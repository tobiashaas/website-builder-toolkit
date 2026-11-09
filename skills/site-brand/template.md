---
# Brand profile. One file per brand, saved as website-builder/brand.md in the project (not in this toolkit).
# The front matter is read by slop-lint (site-audit skill); the sections below are read by agents.
# Leave a value empty rather than guessing. Empty means "ask the user".

name: ""                  # brand or product name as written
source_of_truth: ""       # empty = this file is the original; otherwise where the binding rules live (wiki, vault, design system)
generated_at: ""          # date this copy was generated or last checked against the source (YYYY-MM-DD)
sources:                  # files the copy was built from, with their last-modified date at generation time
  - { path: "", modified: "" }
address: ""               # how readers are addressed: you | Sie | du
register: ""              # formal | neutral | casual  (English has only "you"; formality lives in the register)
address_overrides: []     # areas with a different address, e.g. - { path: "karriere/**", address: "du" }
gendering: ""             # none | colon | star | pair | neutral  (German: none = classic forms only)
motion: subtle            # none | subtle | expressive
contrast: aa               # aa (WCAG 2.2 AA) | aaa (7:1 body text where practical)

colors:                   # every brand color with its job; neutrals included
  - { name: "", hex: "", role: "accent" }
  - { name: "", hex: "", role: "text" }
  - { name: "", hex: "", role: "surface" }
accent_budget: "a few percent of the screen"

fonts:                    # families actually licensed and loaded
  - ""

banned_words: []          # single words that must never appear
banned_phrases: []        # phrases, slogans or constructions that must never appear
claims_never: []          # promises the brand may not make (guarantees, response times, "100 %")
---

# Brand profile: {name}

## Offer
One sentence: what the brand does and for whom.

## Audience
Who reads this, what they are afraid of getting wrong, what they need to see to trust it.

## Character
Two or three concrete words. Not allowed: modern, clean, sleek, minimal, premium, innovative.

## World
The place, material or work this brand belongs to. Neutrals and accent are derived from it.

## Voice
- Address form and register:
- Sentence style (length, rhythm):
- Do:
- Don't:
- Approved lines (verbatim, with where they were approved):

## Visual identity
- Logo files and usage rules (link):
- Type scale or framework tokens in use:
- Shape language (radius, borders, depth):
- Imagery: what counts as a real image for this brand, what is never used:
- Icon set:

## Facts
Checkable facts the brand may state, each with a source. Anything not listed here is not stated.

| Fact | Source | Checked |
| --- | --- | --- |
|  |  |  |

## Signature (optional)
One small detail only this brand uses, and where.

## Stack
- CSS framework: none | Automatic.css | Tailwind | other
- Builder: none | Etch | Bricks | other
- Build rules live in: (path to the project's agent file or toolkit)

## Review
- Owner:
- Last reviewed:
