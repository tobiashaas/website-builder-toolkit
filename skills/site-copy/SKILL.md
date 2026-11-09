---
name: site-copy
description: "Write or rewrite copy in a brand's voice without AI tells: headlines, body, UI labels, empty and error states, dashboards, social posts and carousels, in German or English. Uses only facts from the brand profile, never invents numbers, customers or promises. Use whenever text is written or changed, when copy sounds generic, hyped or machine-written, or when applying a voice or tone guide."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Copy and tone

Composes with: `site-brand` (voice, facts, banned words), `site-audit` (lint with `--lang` and `--brand`). Language files: [de.md](de.md), [en.md](en.md).

Copy comes from the brand profile's voice section. This file covers how to apply a voice and what reads as generated in any language. Language specifics: the language file in the `site-copy` skill.

## Before writing

1. Read the profile's voice, approved lines, banned words, banned phrases, claims to avoid and the facts table.
2. Read text the brand or the user wrote themselves (approved pages, their messages). Match vocabulary, sentence length and directness, not their typos.
3. Collect the facts you will use. Every number, name and claim traces to the facts table or to the user. If something is missing, ask or leave a visible placeholder like `[FACT: number of locations]`. Never fill it in.

## Prohibitions

- Do not invent numbers, customers, quotes, reviews, response times or guarantees.
- Do not use banned words, banned phrases or anything in `claims_never`.
- Do not use hype words, exclamation marks, greeting headlines or rhetorical questions in body copy.
- Do not write headlines a competitor could use unchanged.
- Do not repeat on screen what the design already says (subtitle restating the title, description paraphrasing the button).
- Do not use placeholder names (John Doe, Max Mustermann, Acme) in anything a person sees.
- Do not use more than one emoji in a social post; none in headings, buttons or as word replacements.

## Register for B2B

Business buyers want to avoid a wrong decision more than they want to be excited. Show reliability and lower risk: who does the work, what happens when something breaks, what it costs per month, which customers already use it. Named people and checkable facts carry trust; adjectives don't. Calls to action stay quiet: most readers are not buying today, and the piece should be remembered when they are.

For value propositions, check claims against a structured list of value (functional, ease of doing business, individual, inspirational) instead of adding adjectives. If a claim has no fact behind it, cut it.

## Making it specific

- Use the brand's nouns: its products, places, numbers, people.
- Replace an adjective with the fact that earned it: "fast" → the time; "local" → the town; "experienced" → the years, if the profile lists them.
- One idea per sentence, full sentences. Avoid staccato fragments for rhythm.
- A contrast ("not X but Y") only when the contrast itself is the information.

## Dashboards and UI text

- Labels are nouns, no periods. Buttons are verbs for the action.
- Empty states say what to do next. Errors say what happened and keep what the user typed.
- Numbers carry their unit and comparison. Show the consequence ("3 contracts end in 14 days") rather than the raw value when the reader has to act.

## Social posts and carousels

- The first line carries the whole message; most readers stop there.
- Match the reader's phase: explain when they are discovering, show proof when they compare, give the date and place when they are ready.
- Relationship and real work (a customer project, a team member's observation) over pure product posts.
- Functional products get useful content: a checklist, a number, a fix. Not entertainment for its own sake.
- Links go where the platform rewards them (for LinkedIn usually the first comment), with one sentence on why to click.

## Check

- Lint with `--lang` and `--brand` clean.
- Every number and name ticked against the facts table.
- Read the headline with a competitor's name in it. If it still works, rewrite.
