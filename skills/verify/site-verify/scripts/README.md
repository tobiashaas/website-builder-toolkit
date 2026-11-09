# render-check

Renders a live URL in the locally installed Chrome at several widths and measures what a screenshot doesn't show: horizontal overflow, text contrast over the real background, gradient text, endless animations, missing alt text and names, small targets, zoom lock, console errors. Saves a full-page screenshot per width.

- Node 22 or newer (global `WebSocket`), no dependencies, one file: `scripts/render-check.mjs`
- Google Chrome, Chromium or Edge installed locally; driven through the Chrome DevTools Protocol, headless, with a temporary profile
- License: MIT (see `LICENSE` in the repository root)

## Usage

```sh
node scripts/render-check.mjs https://example.com/
node scripts/render-check.mjs https://example.com/ --widths 390,1440 --reduced-motion
node scripts/render-check.mjs https://example.com/ --format json --no-out
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `--widths` | comma-separated CSS px | `360,390,768,1024,1280,1440,1920` | viewport widths; below 768 the page is emulated as a phone (`mobile: true`, touch, height 844) |
| `--format` | `text`, `json` | `text` | output format |
| `--out <dir>` | path | see below | folder for `report.md` and `<width>.png` |
| `--no-out` | flag | | write no files, even inside a project |
| `--reduced-motion` | flag | off | emulate `prefers-reduced-motion: reduce`; animations that still run become errors |
| `--level` | `aa`, `aaa` | `aa` | contrast level: 4.5:1 and 3:1 (AA) or 7:1 and 4.5:1 (AAA) |
| `--wait` | ms | `3000` | wait after the load event, before the page is scrolled through once and measured |
| `--chrome <path>` | path | auto | browser binary; `CHROME_PATH` works too |

Without `--out`, files go to `website-builder/reports/<YYYY-MM-DD>-<slug>-render/` when a `website-builder/` folder exists in the current directory or a parent (same convention as the other scripts); otherwise nothing is written.

Chrome is looked up in the usual install paths: `Program Files`, `Program Files (x86)` and `%LOCALAPPDATA%` on Windows, `/Applications` and `~/Applications` on macOS, `google-chrome`, `chromium` and friends on the Linux `PATH`. Startup can take more than 10 s; the script waits up to 30 s.

## Checks

Per width, on a fresh tab:

| Check | Severity | What |
| --- | --- | --- |
| `reflow` | error | `scrollWidth > clientWidth` (WCAG 1.4.10). Lists the outermost elements past the right edge with width and right edge; skips `position: fixed` and everything inside a box with `overflow-x` other than `visible` (sliders, scroll containers) |
| `contrast` | error | text color against `CSS.getBackgroundColors` (the method DevTools uses), WCAG 2.x ratio, large text at ≥ 24 px or ≥ 18.66 px and weight ≥ 700; up to 300 distinct text elements |
| `contrast` | manual | text over a `url()` background image, `img`, `video` or `canvas`, a gradient where some stops pass and some fail, or a filter or blend mode; one finding per image source, never a guessed ratio |
| `gradient-text` | warn | `background-clip: text` |
| `animation` | warn | running animations with `animation-iteration-count: infinite`, with their names |
| `reduced-motion` | error | with `--reduced-motion`: animations still infinite, or still moving (`transform`, `translate`, `rotate`, `scale`, offsets) |
| `image-alt` | error | rendered `img` without an `alt` attribute |
| `accessible-name` | error | link or button without text, `aria-label`, `aria-labelledby`, `title` or an `img alt` inside |
| `target-size` | warn | `a`, `button`, `input`, `select`, `textarea`, `[role=button]` smaller than 24 × 24 CSS px (WCAG 2.5.8); inline links inside running text are exempt |
| `viewport-meta` | error | `user-scalable=no` or `maximum-scale` below 2; warn when the tag is missing |
| `console` | warn | exceptions, `console.error`, error log entries, failed requests and HTTP 4xx/5xx responses |
| `load` | error/warn | navigation failed, or no load event within 45 s |

The same finding at several widths is reported once, at the first width, with the other widths in `alsoAt`.

## Output and exit codes

Text output is grouped by width, then by check, and ends with a summary line:

```
390 px
  reflow
    error  html  document is 404 px wide in a 390 px viewport (horizontal scroll, WCAG 1.4.10)
    error  div.card__content > div.heading-wrapper > p.eyebrow  387 px wide, right edge at 403 px (width 386.531px, min-width auto)
  contrast
    manual section.hero > p.lede  background-image on section.hero: 4 text element(s) over it, first "…"; sample the lightest and darkest spot behind the text with contrast.mjs (needs up to 4.5:1)

render-check: 2 error(s), 0 warning(s), 1 manual check(s) at 2 width(s)
```

`--format json` prints `{ tool, version, url, browser, level, reducedMotion, widths, outDir, summary: { error, warn, manual }, findings: [{ width, check, severity, selector, detail, alsoAt, [ratio, fg, bg] }] }`.

With an output folder: `report.md` (one table per width, screenshot linked) and `<width>.png` (full page, at most 16000 px tall).

Exit codes: `0` no error-level finding, `1` at least one, `2` usage error, Node older than 22, Chrome not found or not starting.

## Tests

```sh
node scripts/test/run.mjs
```

Serves the pages in `scripts/test/fixtures/` on a random local port: one with deliberate problems (overflow, low contrast, gradient text, endless animation, image without alt, icon-only button, tiny target, zoom lock, exception, 404), one clean, one with guarded and unguarded motion. Skips with a message when Chrome or Node 22 is missing.

## Known limitations

- Automated checks only. Keyboard, focus order, screen reader output, 200 % and 400 % zoom and text spacing need a person (`site-accessibility`).
- One state per page: the load state after one scroll pass. Menus, dialogs, hover, focus and form errors are not opened.
- Contrast ignores `opacity` on ancestors, `text-shadow` and text over other text; the probe samples the paint stack at the element's center only.
- Animations driven by `requestAnimationFrame` (GSAP, many sliders) are invisible to `document.getAnimations()`; watch them with `--reduced-motion` in a real browser.
- Target size doesn't apply the spacing exception of 2.5.8; check listed targets by hand.
- `--hide-scrollbars` is on, so desktop widths have no classic scrollbar; layouts that only break with a 15 px scrollbar won't show.
- Fixed and sticky elements stretch along with an overflowing page on phones; the outermost non-fixed offender is the cause to fix.
