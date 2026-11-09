# inventory

Builds a page inventory of a live site: discovers URLs from `robots.txt`, the XML sitemap and internal links, fetches each one and records status, redirects, title, description, canonical, robots, headings, word count, links, hreflang, JSON-LD types and images. Derives structural findings (duplicates, missing H1, redirect chains, orphans, click depth, URL patterns). Reports only; it never changes the site.

- Node 18 or newer, no dependencies, one file: `scripts/inventory.mjs`
- GET requests only, no forms, no JavaScript execution; fetched content is treated as data
- License: MIT (see `LICENSE` in the repository root)

## Usage

```sh
node scripts/inventory.mjs https://example.com/
node scripts/inventory.mjs https://example.com/ --max 60 --no-out
node scripts/inventory.mjs https://example.com/ --sitemap https://example.com/sitemap_index.xml --format json
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `--sitemap <url>` | URL | from `robots.txt` | sitemap or sitemap index to read; without it the `Sitemap:` lines of `robots.txt` are used, then `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml` |
| `--max` | integer | `500` | at most this many URLs fetched; sitemap URLs come first, then linked URLs breadth-first |
| `--concurrency` | 1–16 | `4` | parallel requests |
| `--delay` | ms | `250` | pause per worker after each URL; a larger `Crawl-delay` in `robots.txt` wins (capped at 10 s) |
| `--same-host` | flag | off | treat only the exact host as internal; by default `www.example.com` and `example.com` count as the same site |
| `--format` | `md`, `csv`, `json` | `md` | what goes to stdout; files are always written in all three formats |
| `--out <dir>` | path | see below | folder for `inventory.csv`, `inventory.json`, `report.md` |
| `--no-out` | flag | | write no files, even inside a project |
| `--user-agent` | string | `website-builder-toolkit-inventory/0.1 (+https://github.com/tobiashaas/website-builder-toolkit)` | request header; `robots.txt` groups are matched against its first token |

Without `--out`, files go to `website-builder/structure/inventory-<YYYY-MM-DD>/` when a `website-builder/` folder exists in the current directory or a parent (same convention as the other scripts); otherwise only stdout is written.

## Discovery

1. The start URL is fetched first; its final URL (after redirects) defines the site host.
2. `robots.txt`: rules of the `*` group and of a group naming this tool are both applied (Allow/Disallow, `*` and `$`, longest match wins). Disallowed URLs are never requested and are listed as `robots-blocked`. A missing file means no rules.
3. Sitemaps: index files are followed up to three levels and 50 files; `.gz` files are unpacked. URLs on other hosts are skipped.
4. Links: internal `<a>` and `<area>` targets of every fetched HTML page are queued. Links to files (images, PDFs, CSS, JS, archives) count as links but are not fetched. Links with action-like parameters (`add-to-cart`, `action`, `logout`, `_wpnonce`, `replytocom` and similar) and `wp-admin`/`wp-login.php` are skipped.
5. Without a sitemap, discovery is link crawling from the start page only.

Normalisation: fragments and tracking parameters (`utm_*`, `gclid`, `fbclid` and similar) are stripped. The trailing slash follows the majority of the sitemap URLs and the start page's links (files with an extension are left alone). A URL with a query string that declares a canonical is folded into the canonical (`canonicalisedTo`), so `?ref=` variants don't show up as duplicates.

Redirects are followed by hand (up to 10 hops) and recorded per hop. The target of a redirect becomes its own row; the redirecting URL keeps the chain and the final status.

## Recorded per URL

`url`, `source` (`start`, `sitemap`, `link`, `redirect`, `canonical`), `in_sitemap`, `sitemap_lastmod`, `status`, `final_url`, `redirect_hops`, `redirect_chain`, `error`, `content_type`, `title` and its length, `meta_description` and its length, `canonical`, `canonical_self`, `meta_robots`, `x_robots_tag`, `noindex`, `lang`, `h1_count`, `h1_first`, `h2` (up to 10), `word_count`, `internal_links`, `external_links`, `inbound_internal_links`, `click_depth`, `hreflang`, `jsonld_types`, `images`, `images_without_alt`. The JSON file adds the outgoing internal link targets per page (`outlinks`) and the full edge list (`links`).

Word count covers visible text after removing `script`, `style`, `noscript`, `template`, `svg`, `iframe`, the `head`, and every `nav`, `header` and `footer` element.

## Findings

| Check | Severity | What |
| --- | --- | --- |
| `status` | error | final status other than 200, failed fetch, redirect loop |
| `noindex-in-sitemap` | error | sitemap lists a page with `noindex` (meta robots or `X-Robots-Tag`) |
| `duplicate-title`, `duplicate-description` | warn | indexable pages sharing the same value (case-insensitive) |
| `missing-title`, `missing-description` | warn | |
| `missing-h1`, `multiple-h1` | warn | |
| `redirect-chain` | warn | more than one hop |
| `canonical-elsewhere` | warn | canonical points to another URL |
| `orphan` | warn | in the sitemap, but no internal link from any crawled page (only with a sitemap) |
| `click-depth` | warn | more than 3 clicks from the start page |
| `sitemap-blocked` | warn | sitemap lists a URL that `robots.txt` disallows |
| `title-length` | info | title over 60 or under 15 characters |
| `description-length` | info | description over 160 or under 50 characters |
| `thin` | info | fewer than 150 words of visible text |
| `sitemap-redirect`, `linked-redirect` | info | sitemap entry or internal links point to a redirecting URL |
| `not-in-sitemap` | info | indexable page reached by links but missing from the sitemap |
| `noindex`, `unreachable`, `missing-lang`, `image-alt`, `jsonld-invalid` | info | |
| `url-depth`, `url-uppercase`, `url-underscore`, `url-parameters`, `url-length` | info | path deeper than 3 segments, uppercase, underscores, query parameters, over 115 characters |
| `robots-blocked`, `max-reached`, `no-sitemap`, `sitemap-fetch`, `sitemap-foreign-host` | info | crawl scope notes |

Click depth is computed breadth-first over the internal links of all fetched pages, with redirects resolved to their targets.

## Output and exit codes

- `inventory.csv`: one row per fetched URL, columns in the order above, UTF-8 with BOM and CRLF for Excel. Cells starting with `=`, `+`, `@` or `-` followed by a letter are prefixed with `'` so fetched text can't run as a formula.
- `inventory.json`: `{ tool, version, generatedAt, startUrl, start, site, options, slashConvention, robots, sitemaps, summary, findings: [{ severity, check, message, urls }], pages, links, blocked, notFetched, skippedUnsafe, outDir }`.
- `report.md`: summary counts, findings grouped by severity (25 URLs per finding, the rest in the JSON), URL tree by first and second path segment, click-depth histogram, sources.

A one-line summary goes to stderr. Exit codes: `0` after a completed run, whatever the findings; `1` usage error or the start URL can't be fetched (network error or HTTP 4xx/5xx).

## Tests

```sh
node scripts/test/run.mjs
```

Serves two fixture sites from `scripts/test/fixtures/` on random local ports. `site-a`: `robots.txt` disallowing `/private/`, sitemap index with one sitemap, a duplicate title, a missing H1, a redirect chain of 2, a 404 in the sitemap, an orphan, a noindex page in the sitemap, a page 4 clicks deep, URL patterns. `site-b`: no `robots.txt`, no sitemap, crawled by links.

## Known limitations

- HTML is parsed with tolerant regular expressions, not a DOM. Pages rendered by JavaScript show only their server HTML; links added by scripts are not seen.
- `--max` cuts the crawl: orphan, click-depth and inbound counts only cover fetched pages, so they can over-report on a partial run (the report says so with `max-reached`).
- Word count removes `nav`, `header` and `footer` by element name; navigation built from `div`s still counts, and a `header` inside an `article` is removed too.
- Duplicate checks compare exact text after trimming and lowercasing; near-duplicates are not detected.
- Robots matching follows the common subset of RFC 9309. An unreachable `robots.txt` (5xx, timeout) is treated as no rules and noted, not as disallow-all.
- No login, cookies or JavaScript; pages behind consent walls or bot protection return what a plain HTTP client gets.
