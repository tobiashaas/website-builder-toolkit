# contrast

WCAG 2.x contrast ratios for one color pair or a whole brand palette, with pass/fail per level, alpha compositing and suggested shades for failing pairs.

- Node 18 or newer, no dependencies, one file: `scripts/contrast.mjs`
- License: MIT (see `LICENSE` in the repository root)
- Formula: WCAG 2.2 relative luminance (sRGB, linearisation threshold 0.04045) and `(L1 + 0.05) / (L2 + 0.05)`

## One pair

```sh
node scripts/contrast.mjs "#292929" "#ffffff"
```

```
#292929 on #ffffff  14.55:1
  AA normal text   4.5:1  pass  (1.4.3)  <- required
  AA large text    3:1    pass  (1.4.3)
  AAA normal text  7:1    pass  (1.4.6)
  AAA large text   4.5:1  pass  (1.4.6)
  UI / graphics    3:1    pass  (1.4.11)
```

The first color is the foreground (text, icon, border), the second the background. Without a second color, `--bg` is the background.

Colors: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (comma or space syntax, numbers or percentages, `/ alpha`), `hsl()`/`hsla()` (`deg`, `turn`, `rad`, `grad`), `black`, `white`. Quote them in the shell.

Pass/fail uses the unrounded ratio, as WCAG requires. The ratio prints with two decimals; when rounding would show a passing value for a failing pair (4.496 as "4.50"), it prints three decimals, truncated.

### Translucent colors

A foreground with alpha is composited over the background before measuring, the way the browser paints it. A background with alpha is first composited over `--bg` (default `#ffffff`, the page).

```sh
node scripts/contrast.mjs "rgba(0,0,0,.5)" "#fff"                  # 3.98:1, composited #808080
node scripts/contrast.mjs "rgb(255 255 255 / 90%)" --bg "#1a1a1a"  # white text at 90 % on a dark page
node scripts/contrast.mjs "#000" "rgba(255,255,255,.5)" --bg "#000" # overlay panel on a dark page
```

For text over a photo, sample the lightest and the darkest spot behind the text and check both.

## Brand matrix

```sh
node scripts/contrast.mjs --brand website-builder/brand.md --suggest
node scripts/contrast.mjs            # same, with website-builder/brand.md found in this folder or a parent
```

Reads `colors` from the YAML front matter of the brand profile (`- { name, hex, role }`, same parser as slop-lint) and checks:

| Foreground role contains | Background role contains | Checked at |
| --- | --- | --- |
| `text`, `ink`, `foreground`, `fg`, `heading`, `body`, `copy`, `link` | `surface`, `background`, `bg`, `canvas`, `paper`, `base`, `page` | text level (4.5:1, or 7:1 with AAA) |
| `accent`, `primary`, `secondary`, `brand`, `ui`, `icon`, `border`, `focus`, `cta`, `button` | same | UI / graphics (3:1) |

If the profile has no text role or no surface role, every pair of colors is checked at text level, so expect failures between colors that never meet; name the roles to get a useful matrix. Auto-detection follows the slop-lint convention: the nearest `website-builder/` folder upwards with a `brand.md` or `setup.md`; `brand: none` in `setup.md` switches it off; `brand: other.md` points elsewhere in the folder.

An accent that is also used as link or button text belongs in the text check: give it a role such as `accent, link`.

## Options

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `--bg <color>` | any color | `#ffffff` | background for a single color; page under translucent backgrounds |
| `--kind` | `text`, `large`, `ui` | `text` | which check decides pass/fail: normal text, large text (≥ 24 px, or ≥ 18.66 px bold), or non-text (1.4.11) |
| `--level` | `aa`, `aaa` | `aa`, or `contrast:` in the brand profile | level that decides the exit code; `ui` stays 3:1 at both levels |
| `--brand <file>` | path | auto-detected | brand matrix instead of one pair |
| `--suggest` | flag | off | for each failing pair, the nearest darker and lighter shade of the foreground that passes AA, plus AAA with `--level aaa` |
| `--apca` | flag | off | also print the APCA Lc value |
| `--format` | `text`, `json` | `text` | output format |

A brand profile can set the default level with one front-matter line: `contrast: aaa` (7:1 for body text). `--level` wins.

### Suggestions

`--suggest` keeps the foreground's OKLCH hue and chroma and moves only lightness, in small steps, until the 8-bit result passes; chroma is reduced only where the shade would leave sRGB. It reports the shade, its ratio and the lightness change (`dL`). A missing direction means no shade of that hue reaches the level on that background. Suggestions are a starting point: put the new shade into the brand profile, not straight into a page.

### APCA

`--apca` prints the APCA Lc value from the published APCA-W3 constants 0.0.98G-4g (text first, background second; negative for light text on dark). It is informational only. APCA is not part of WCAG 2.2 and not a conformance requirement; pass/fail and the exit code never depend on it.

## Output and exit codes

`--format json` prints `{ tool, version, level, [brand, mode], results: [{ fg, bg, fgHex, bgHex, kind, ratio, ratioText, checks: { aaNormal, aaLarge, aaaNormal, aaaLarge, ui }, required: { check, min }, pass, composited?, apcaLc?, suggestions? }], summary: { checked, failed } }`. `fgHex` and `bgHex` are the composited, opaque colors that were measured.

Exit codes: `0` every checked pair passes the required level, `1` at least one fails, `2` usage error (bad color, option or brand file; no colors and no brand profile found).

## Tests

```sh
node scripts/test/run.mjs
```

Known pairs (`#000` on `#fff` 21:1, `#777` 4.48:1, `#767676` 4.54:1), color syntax, compositing, levels, suggestions, APCA reference values from `apca-w3` 0.1.9, brand fixtures and auto-detection.

## Known limitations

- Measures colors, not pages. Text over images, gradients, `mix-blend-mode`, filters and opacity on parent elements must be sampled from the render and passed in.
- Colors outside sRGB (`oklch()`, `color(display-p3 …)`, named colors other than black and white) are not parsed. Convert them first.
- Large text is a size decision the script can't see; pass `--kind large` only when the text is ≥ 24 px, or ≥ 18.66 px and bold.
- Role detection is by keyword. Unusual role names fall back to the all-pairs matrix.
