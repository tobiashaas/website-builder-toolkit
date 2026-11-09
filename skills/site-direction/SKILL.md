---
name: site-direction
description: "Write the design direction and skeleton for a page, screen, carousel or campaign from the brand profile, and get it confirmed before anything is styled: offer, character, world, moment, signature, one concept sentence, and the section and token skeleton. Use at the start of any new design or redesign, after an audit finds many tells, or when the user wants options; renders two or three variants for important pieces."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Direction

Composes with: `site-brand` (the profile it reads), `site-audit` (findings it responds to), `site-design` (runs after it).

The direction is written before anything is styled and confirmed by a human. Research on coding agents found that a human-set direction with the agent evaluating beats an agent-invented direction, and that structure given up front cuts failures sharply (see `docs/EVIDENCE.md`). Treat that as the reason this step is not optional.

If `website-builder/structure.md` exists, take the page's job, audience, type and main search term from it; do not redefine them here.

## Five lines

Derive each from the brand profile and the job of this piece, never from what is trending.

- **Offer:** what this piece is for and who reads it, in one sentence.
- **Character:** two or three concrete words, taken from the profile. Banned: modern, clean, sleek, minimal, premium, innovative. They describe every template.
- **World:** the place, material or work the brand belongs to. It sets neutrals and accent. It does not have to become a picture.
- **Moment:** the one or two places the piece gets its richness (see the moment list in `site-design`).
- **Signature:** one small detail only this brand uses. Take it from the profile if it has one; otherwise propose one and mark it as a proposal.

Then one **concept sentence** that every later choice is checked against. Two tests before keeping it:

1. **Does it survive the next state?** Walk it through empty, in use and done. A concept that only works on the first frame is a poster.
2. **Does it rule something out?** If it only justifies what you already wanted, it filters nothing.

## Where it goes

Save the confirmed direction and skeleton as `website-builder/direction/<page>.md` (create the folder if it is missing), with the date and who confirmed it.

## Skeleton

Together with the direction, write the skeleton: sections in order, the components each uses, and the tokens or variables in use (spacing scale, color roles, type sizes). The human confirms both. Styling starts after that.

## Variants for important pieces

For a homepage, a landing page or a campaign visual, render two or three genuinely different directions as rough drafts side by side at real size. Select with lint, the checks in `site-verify` and the human's choice, not by polishing the first draft through more prompting. For routine pieces one direction is enough.

## When there is no brand profile

- Ask for it, or run the `site-brand` skill.
- If you were told to proceed anyway: write `Brand (assumed): …` and keep everything neutral and reversible. Do not invent facts, claims, logos or colors that look like a real brand's.

## When the piece names no product

Mock or demo: assume one specific, plausible product with a particular world and write `Product (assumed): …` so it can be overruled. Do not default to a generic software product. The assumption must fit the features being kept.

## Category-typical, not template

First impressions favour low visual complexity and layouts that look typical for their category. Distinctiveness comes from voice, real imagery and the signature, not from an unfamiliar layout in the first screen. "Typical" means the structure readers expect (navigation, a clear headline, one action); "template" means the default details (gradient hero, three equal cards, stock copy). Keep the first, remove the second.
