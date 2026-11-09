# Signs of generated design and copy

> Adapted from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, CC BY 4.0, via charles-unslop. Rewritten for any stack and extended with copy and brand tells. Keep this credit in copies.

Walk every group. Note each sign with where it lives (file and line, or screen region). Each line pairs the sign with its fix. Signs marked **(lint)** are also caught by `slop-lint` (in the `site-audit` skill); the script is a floor, not a substitute for looking at the rendered screen.

## Surfaces and color

- Purple-to-blue or violet-to-pink gradients on backgrounds, buttons or the active nav item **(lint)** → one neutral surface, the brand accent only where it means something
- Gradient text in headings, numbers or the logo **(lint)** → solid text color from the profile
- Colored glows and colored shadows **(lint)** → depth from surface steps and hairlines
- Blurred blobs, orbs or radial washes behind content with no reason in the brand's world → remove
- Neon or saturated borders → hairline at 6–10 % opacity of the text color
- Five near-identical tints of one hue for text → three text roles from one neutral ramp
- Everything highlighted, so nothing stands out → one accent, once or twice per screen
- Frosted glass over a flat background → a plain raised surface; glass only with something meaningful behind it
- A color not in the brand profile **(lint with `--brand`)** → use the palette or propose an addition

## Type

- Headings at weight 800–900 **(lint)** → 400–600 and size for hierarchy
- Uppercase labels with wide tracking **(lint)** → sentence case, unless the borrowed real object is uppercase (a stamped tag, a boarding pass)
- Too many sizes and weights on one screen → at most five sizes, two or three weights
- Mixed number formats on one screen → one format, tabular figures
- Negative letter-spacing on small text → zero below ~28 px
- Italic for emphasis → color or weight
- A font that is not in the brand profile → the profile's families

## Icons

- Emoji as navigation, decoration or status **(lint)** → one line-icon set, or nothing
- Icons in several sizes, strokes and colors → one size, one stroke, a text color
- A sparkle for anything AI **(lint)** → remove; the copy says what the AI does
- Grey third-party logos → logos of known services keep their real colors; people recognise them before reading

## Spacing

- One-off values like `13px`, `7px`, `31px` **(lint)** → steps on the project's spacing scale
- Rows in one list with different heights or gaps → one height, one gap
- Groups that sit closer to their neighbours than to their own items → smaller gaps inside groups, larger between them
- Uneven padding in sibling cards → one padding
- A large gap above a section and a cramped one below → balanced rhythm

## Copy

- Greeting headlines ("Welcome back!") **(lint)** → the page or period as the title
- Exclamation marks in headings and buttons **(lint)** → plain statement
- Hype words: supercharge, seamless, unlock, revolutionize, next level, cutting-edge, world-class **(lint)** → what the thing does
- Changes without a reference ("+12%") **(lint, info)** → "+12 % vs last month"
- Wordy placeholders ("Search anything…") → "Search"
- Trailing periods on labels and buttons **(lint)** → none
- Placeholder data and names: Lorem ipsum, John Doe, Acme, 123,456 **(lint)** → real, approved content, or clearly marked draft
- Cute lines that only sound human → say the plain thing
- A headline a competitor could paste unchanged → the brand's own nouns: its products, places, numbers
- Metadata repeating what the screen already shows → cut
<!-- slop-lint-disable-next-line copy/unsourced-social-proof -->
- Unsourced social proof ("Trusted by 10,000+ teams", five stars) **(lint)** → a fact from the profile with its source, or nothing
- A claim the profile lists under `claims_never` **(lint with `--brand`)** → remove
- Language-specific tells → see `de.md` in the `site-copy` skill, `en.md` in the `site-copy` skill

## Components

- Glowing pills for counts, plans or status → plain text or a quiet tag
- `NEW`, `PRO`, `BETA` badges everywhere → one quiet text badge where it is news
- Every element a full pill → radius by size, nested radius = outer − padding
- Rainbow or glowing chart bars → one or two series, muted grid, one highlight color
- Sparklines and icons added to every stat card → number, label, change
- Equal cards side by side with the same layout → one main element, varied widths
- Logo as a gradient tile, glossy orb or glowing dot → the real logo, flat

## Layout and heroes

- Pill badge above the headline ("Introducing…") → remove, or a quiet text link if it is real news
- Everything stacked and centered → a layout set by what the content needs
- Three equal cards, bento grids, picture-left form-right → size by importance
- Three or more buttons → one primary, at most one secondary
- Blobs, grids, glowing lines behind the hero → a calm background or one real product image
- A dead band of empty space at wide viewports → fill it with real content or recompose

## Visuals

- Glossy 3D, liquid chrome, robots, glowing brains, circuit lines, holograms → the real product, a real photo from the work, or no image
- Text, fake buttons or a fake logo baked into an image → real text in the page
- An image with a hard edge and a different black than the page → matched background, soft edge
- A visual on every section → one visual where it helps

## Motion

- Pulsing or breathing on things that are not live **(lint)** → static
- `transition: all` and scale-up on hover **(lint)** → a color or surface step on hover, a slight scale-down on press
- Bouncy overshoot on simple UI → one ease-out curve
- Everything flying in from different directions on load → one short fade-and-rise, small stagger, or nothing
- Parallax and floating loops → static
- Animating width, height, top or left **(lint)** → transform and opacity

## Structure

- A divider where spacing already groups → remove
- A subtitle that restates the title → remove
- A container inside a container inside a card → run content to its parent's edges
- Two mechanisms for one job (progress bar and step counter) → keep one
- A control floating beside the thing it acts on → part of that thing's state

## Accessibility tells (generated UI skips these)

- Focus outline removed with no replacement **(lint)** → a visible focus style in a neutral color
- Zoom disabled in the viewport meta **(lint)** → allow zoom
- Images without `alt` **(lint)** → meaningful alt, or empty alt for decoration
- "Click here" links **(lint)** → link text that names the destination
- Text under 4.5:1 contrast over its real background → fix the color, not the opacity

## Template look

Not slop, but what a cleaned-up screen falls back to when nobody decided:

- Grey page, Inter, white text, the brand color on one button → neutrals and accent derived from the brand's world
- A hero image that is an empty box or a generic stock photo → the real product or real work
- Every page with the same layout → let the direction decide
