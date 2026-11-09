# seo-check

On-page SEO check for a list of URLs: head basics, headings, images, links, JSON-LD structured data against a subset of Google's rich-result requirements, whether structured data matches the visible text and the brand profile, and an indexability summary per page. Reports only; it never changes the site.

- Node 18 or newer, no dependencies, one file: `scripts/seo-check.mjs`
- GET requests only, no forms, no JavaScript execution; fetched content is treated as data
- License: MIT (see `LICENSE` in the repository root)

## Usage

```sh
node scripts/seo-check.mjs https://example.com/
node scripts/seo-check.mjs https://example.com/ https://example.com/kontakt/ --brand website-builder/brand.md
node scripts/seo-check.mjs --from-inventory website-builder/structure/inventory-2026-11-09/inventory.json --format md
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `<url...>` | URLs | | pages to check; duplicates are removed |
| `--from-inventory <file>` | path | | adds the pages of an `inventory.json` from `site-structure/scripts/inventory.mjs`: status 200, HTML, no redirect, not folded into a canonical |
| `--brand <file>` | path | `website-builder/brand.md` if it exists | brand profile for the name, address and phone comparison; `--no-brand` turns it off |
| `--max` | integer | `200` | at most this many URLs; the rest is counted as `skippedByMax` |
| `--delay` | ms | `250` | pause between requests; a larger `Crawl-delay` in `robots.txt` wins (capped at 10 s) |
| `--format` | `text`, `json`, `md` | `text` | what goes to stdout |
| `--out <dir>` | path | see below | folder for `report.md` and `seo-check.json` |
| `--no-out` | flag | | write no files, even inside a project |
| `--user-agent` | string | `website-builder-toolkit-seo/0.1 (+https://github.com/tobiashaas/website-builder-toolkit)` | request header; `robots.txt` groups are matched against its first token |

Without `--out`, files go to `website-builder/reports/<YYYY-MM-DD>-seo/` when a `website-builder/` folder exists in the current directory or a parent; otherwise only stdout is written.

URLs that `robots.txt` disallows are not requested; they get a `robots-txt` finding. Redirects are followed (up to 10 hops) and checked at their target.

## Checks

| Group | Check | Severity | What |
| --- | --- | --- | --- |
| Indexability | `status` | error | fetch failed or final status other than 200 |
| | `redirect` | info | the URL redirects; chain listed |
| | `robots-txt` | warn | disallowed by `robots.txt`, not fetched |
| | `noindex`, `nofollow` | warn | meta `robots`/`googlebot` or `X-Robots-Tag` |
| | `canonical-target` | error | canonical points to a checked page that is not 200, redirects or is noindex |
| | `not-html` | warn | content type is not HTML |
| Head | `missing-title` | error | no or empty `<title>` |
| | `multiple-title` | warn | |
| | `duplicate-title`, `duplicate-description` | warn | indexable checked pages share the value (case-insensitive) |
| | `missing-description` | warn | |
| | `title-length`, `description-length` | info | title under 15 or over 60, description under 50 or over 160 characters |
| | `missing-h1`, `multiple-h1` | warn | exactly one `<h1>` expected |
| | `h1-title-generic` | warn | H1 and title are identical and generic ("Home", "Startseite", the brand name alone) |
| | `missing-canonical`, `canonical-relative` | warn | |
| | `multiple-canonical` | error | more than one canonical with different targets |
| | `canonical-other` | warn | canonical points elsewhere; info for URLs with query parameters |
| | `missing-lang`, `invalid-lang`, `missing-viewport` | warn | |
| | `open-graph` | info | `og:title`, `og:description` or `og:image` missing |
| hreflang | `hreflang-code`, `hreflang-conflict` | error | invalid language code; one code for two URLs |
| | `hreflang-return` | error | an alternate that was checked in the same run does not link back |
| | `hreflang-self` | warn | the set does not include the page itself |
| | `hreflang-x-default`, `hreflang-unchecked` | info | no `x-default`; alternates not in this run, so return links are not verified |
| Headings | `heading-skip`, `empty-heading` | warn | e.g. h2 followed by h4 |
| Images | `image-alt` | error | `img` without `alt` attribute (`alt=""` is fine) |
| | `image-dimensions`, `image-filename` | info | no `width`/`height`; file name of 8+ characters without a word (`IMG_2024…`, hashes) |
| Links | `empty-anchor` | error | no text, image alt, `aria-label` or `title` |
| | `generic-anchor` | warn | "hier", "mehr", "weiterlesen", "mehr erfahren", "click here", "read more" and similar, unless `aria-label` says more |
| | `internal-nofollow`, `insecure-link` | warn | `rel=nofollow` on internal links; `http://` links from an `https` page |
| Structured data | `jsonld-syntax` | error | a `application/ld+json` block is not valid JSON (block index given) |
| | `jsonld-required` | error | a required property for the type is missing |
| | `jsonld-recommended` | info | recommended properties missing |
| | `jsonld-faq-eligibility` | info | FAQ rich results are retired; structure checked only |
| Consistency | `jsonld-not-visible` | error | FAQ questions and answers, product name and price, `aggregateRating` values, event start date, job title or breadcrumb names are not in the visible text |
| | `nap-mismatch` | warn | name, phone, street or postal code in Organization/LocalBusiness JSON-LD or in footer/`<address>`/`tel:` text differs from the brand profile; both values are given |

Findings with `info` are notes, not defects.

## Structured data rules

Checked against the Google Search Central docs on 2026-11-09 (`https://developers.google.com/search/docs/appearance/structured-data/<page>`). Recommended lists are a practical subset. `@graph` members are checked as top-level nodes; `{"@id": …}` references are resolved across all blocks of the page.

| Type | Required | Source page |
| --- | --- | --- |
| Organization (and subtypes) | none (recommended: name, url, logo, address, telephone or contactPoint, sameAs) | `organization` |
| LocalBusiness (and subtypes, also in `@type` arrays) | name, address | `local-business` |
| WebSite | name, url | `/search/docs/appearance/site-names` |
| BreadcrumbList | itemListElement; each ListItem position, name; item on all but the last | `breadcrumb` |
| Article, BlogPosting, NewsArticle | none (recommended: headline, image, datePublished, dateModified, author with name) | `article` |
| Product | name and one of review, aggregateRating, offers; Offer price; AggregateOffer lowPrice and priceCurrency; AggregateRating ratingValue and ratingCount or reviewCount; Review author and reviewRating.ratingValue | `product-snippet`, `review-snippet` |
| Event (and subtypes) | name, startDate, location, location.address | `event` |
| JobPosting | datePosted, description, hiringOrganization, title, jobLocation (with address.addressCountry) or applicantLocationRequirements | `job-posting` |
| FAQPage | mainEntity; each Question name and acceptedAnswer.text (schema.org structure; Google retired FAQ rich results in 2026 and removed the page) | changelog `/search/updates` |
| VideoObject | name, thumbnailUrl, uploadDate | `video` |
| Person, ProfilePage | Person name or alternateName; ProfilePage mainEntity | `profile-page` |

Merchant-listing requirements (image, priceCurrency, shipping, return policy) are not checked.

## Brand profile

From `brand.md` the script reads `name` in the front matter and the first column of the table under `## Facts`. A fact counts as a phone number when it is labelled (Telefon, Tel, Phone, Fon, Mobil) or starts with `+` or `00`; facts labelled only Fax are skipped. Streets are read as `<name>straße|str.|weg|platz|allee|… <number>`, postal codes as five digits followed by a place name. Nothing is guessed: a value that is not in the profile is not compared. Phone numbers match when their digits are equal apart from a country code (`+49 7721 …` equals `07721 …`).

## Output and exit codes

- `report.md`: summary, per page an indexability line and findings grouped by check group, counts per check.
- `seo-check.json`: `{ tool, version, generatedAt, options, brand, summary, pages: [{ url, finalUrl, status, error, redirects, canonical, canonicalSelf, noindex, robotsDisallow, title, jsonLdTypes }], findings: [{ url, check, severity, detail }] }`.
- A one-line summary goes to stderr.

Exit codes: `0` when no finding has severity `error`; `1` when at least one does, on a usage error, or when a page cannot be fetched (a `status` error).

## Tests

```sh
node scripts/test/run.mjs
```

Serves `scripts/test/fixtures/site/` on a random local port and checks the CLI against `fixtures/brand.md`: a clean page with no errors or warnings, a page without title, description and H1, two pages with the same title, a JSON-LD syntax error in block 2, a LocalBusiness subtype without name and address, an FAQPage with a question that is not on the page, a Product whose price is not on the page, a valid BreadcrumbList, an hreflang pair without return link, generic and empty anchors, a footer phone and street that differ from the brand profile, an Event and JobPosting, a `robots.txt` disallow, a redirect, a 404, the data-folder defaults and `--from-inventory`.

## Known limitations

- HTML is parsed with tolerant regular expressions, not a DOM. Content rendered by JavaScript, including JSON-LD injected by scripts, is not seen.
- "Visible text" is all body text outside `script`, `style`, `template` and `noscript`; text hidden with CSS still counts, so the visibility check catches markup without any text on the page, not text that is styled away.
- Long FAQ answers count as visible when 80 % of their word trigrams appear on the page; prices and ratings match as numbers in both `1,234.56` and `1.234,56` notation; dates match common German and English day-month forms.
- Rich-result eligibility also depends on policies, image sizes and site quality that a static check cannot see. Use Google's Rich Results Test for a final check.
- The name check accepts a JSON-LD name that contains the brand name or the reverse, ignoring legal forms (GmbH, AG, …). Street and postal-code patterns target German-style addresses.
- Duplicate and hreflang checks only cover the pages in the run.
- The `insecure-link` check is not covered by the tests (the fixture server is plain http).
