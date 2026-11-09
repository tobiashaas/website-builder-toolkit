# English copy: tells and conventions

Load this when the copy is English. The brand profile decides voice and banned words; this file lists what currently reads as generated. What reads as generated keeps shifting, so treat the list as a floor and check recent discussion of AI writing tells when in doubt. Lint: `node <site-audit>/scripts/slop-lint.mjs <paths> --lang en`.

## Words and phrases that read as generated

| Tell | Fix |
| --- | --- |
| supercharge, unlock, elevate, empower, leverage, seamless, robust, cutting-edge, world-class, game-changer, next-level | say what the thing does, with a number if there is one |
| "In today's fast-paced world…" | start with the fact |
| "It's not just X, it's Y", "X isn't a feature. It's a promise." | state the claim once; contrast only when the contrast is the information |
| "Whether you're a … or a …" | name the reader you actually serve |
| "Say goodbye to…", "Say hello to…" | describe the change |
| "Here's the thing:", "Let's dive in", "delve" | delete |
| Triplets for rhythm ("Fast. Simple. Secure.") | one sentence with a reason |
| Rhetorical questions in body copy | state the situation |
| Em dashes used as a tic in every sentence | commas, periods, or one dash where it helps |
| Exclamation marks | none outside real warnings |

## Conventions

- English has one address form, "you". Formality comes from the profile's `register`: formal (no contractions, full sentences, surnames), neutral (occasional contractions, plain words), casual (contractions, first names, shorter sentences). Keep one register per piece.

- Sentence case for headings and buttons unless the brand profile says otherwise.
- No trailing period on buttons and labels.
- Changes carry their reference: "+12 % vs last month".
- Numbers in one format per screen; tabular figures where they update or align.

## Checks before handing over

1. Swap in a competitor's name. If the headline still fits, rewrite it with the brand's nouns.
2. Every number traces to the profile's facts.
3. Nothing from `claims_never`.
4. Lint passes with `--lang en --brand <profile>`.
