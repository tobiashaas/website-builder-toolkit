<!-- last-reviewed: 2026-11-08 · tested with: Claude Code -->
# Motion

The profile's `motion` value sets the stance: `none` (no animation beyond state feedback), `subtle` (default), `expressive` (showcase and event pages). Research on attention found that strong animation holds the eye but lowered the action people came for, while a subtle background highlight worked best. Default to less.

## Should it move?

1. How often is it triggered? Many times a day or from the keyboard → no animation. Occasionally (menu, dialog) → short and standard. Rarely (success, onboarding) → may be choreographed.
2. Does it answer a question: where did this come from, did my click register, what changed? No → cut it.

## Prohibitions

- Do not pulse, breathe or shimmer things that are not live.
- Do not use `transition: all`; name the properties.
- Do not scale cards up on hover; use a color or surface step.
- Do not animate width, height, top, left or margins; use `transform` and `opacity`.
- Do not fade every section in on scroll. Do not use parallax or floating loops.
- Do not play entrance animations on content already visible at page load.
- Do not ignore `prefers-reduced-motion`: same information, no movement.
- Do not use bounce or overshoot on plain UI.

## Defaults

| What | Duration | Curve |
| --- | --- | --- |
| Hover, press, color | 100–150 ms | ease |
| Menu, tooltip, popover | 150–250 ms | ease-out |
| Dialog, drawer, toast | 200–300 ms | ease-out |
| Page or section transition | 300–400 ms | ease-out |
| Something already on screen moves | as above | ease-in-out |
| Spinner, marquee | constant | linear |

Exits run about a quarter faster than entrances. If it feels slow, shorten it before changing anything else. Interactive motion must be interruptible: start from where the element is, never lock input. Enter from a slightly smaller size and transparent, never from zero size.

## Expressive pages

Showcase and event pages may choreograph one sequence. Write it as a timeline with named timings at the top of the file, keep it under about 2.5 s, give the eye a target throughout, and verify it frame by frame (see `site-verify`). One choreographed moment per page.
