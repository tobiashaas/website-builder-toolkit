#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// seo-check: on-page SEO check of a list of URLs. Head basics, headings, images, links,
// JSON-LD structured data against a subset of Google rich-result requirements, consistency of
// structured data with visible text and with the brand profile (name, address, phone), and an
// indexability summary. Reports only, never fixes.
// Node 18+, zero dependencies, GET only. Usage: scripts/README.md
//
//   node scripts/seo-check.mjs <url...> [--from-inventory <inventory.json>] [--brand <brand.md>|--no-brand]
//        [--format text|json|md] [--out <dir>|--no-out] [--max 200] [--delay 250]
//        [--user-agent "<ua>"]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION = '0.1.0';
const UA_TOKEN = 'website-builder-toolkit-seo';
const DEFAULT_UA = `${UA_TOKEN}/0.1 (+https://github.com/tobiashaas/website-builder-toolkit)`;
const TIMEOUT = 15000;
const MAX_HOPS = 10;
const MAX_BODY = 5 * 1024 * 1024;
const EXAMPLES = 5;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage(msg) {
  if (msg) process.stderr.write(`seo-check: ${msg}\n`);
  process.stderr.write(`usage: node seo-check.mjs <url...> [--from-inventory <inventory.json>] [--brand <brand.md>|--no-brand]
       [--format text|json|md] [--out <dir>|--no-out] [--max 200] [--delay 250]
       [--user-agent "<ua>"]
`);
  process.exit(1);
}

function parseArgs(argv) {
  const a = { urls: [], inventory: null, brand: undefined, format: 'text', out: undefined, max: 200, delay: 250, ua: DEFAULT_UA };
  const int = (t, v, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) usage(`${t} takes an integer between ${min} and ${max}`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) usage(`${t} needs a value`); return v; };
    if (t === '--from-inventory') a.inventory = val();
    else if (t === '--brand') a.brand = val();
    else if (t === '--no-brand') a.brand = null;
    else if (t === '--format') { a.format = val(); if (!['text', 'json', 'md'].includes(a.format)) usage('--format is text, json or md'); }
    else if (t === '--out') a.out = val();
    else if (t === '--no-out') a.out = null;
    else if (t === '--max') a.max = int(t, val(), 1, 10000);
    else if (t === '--delay') a.delay = int(t, val(), 0, 60000);
    else if (t === '--user-agent') { a.ua = val().trim(); if (!a.ua) usage('--user-agent is empty'); }
    else if (t === '-h' || t === '--help') usage();
    else if (t.startsWith('--')) usage(`unknown option ${t}`);
    else a.urls.push(t);
  }
  for (const u of a.urls) {
    try { const p = new URL(u); if (!/^https?:$/.test(p.protocol)) throw 0; } catch { usage(`not an http(s) URL: ${u}`); }
  }
  if (!a.urls.length && !a.inventory) usage('no URL given');
  return a;
}

// ---------------------------------------------------------------------------
// Data folder: website-builder/ in the current directory or a parent
// ---------------------------------------------------------------------------
function findDataFolder(start) {
  let dir = path.resolve(start);
  for (;;) {
    const cand = path.join(dir, 'website-builder');
    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// URLs from an inventory.json written by site-structure/scripts/inventory.mjs: fetched HTML
// pages with status 200, no redirect and not folded into a canonical.
function urlsFromInventory(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { usage(`cannot read inventory ${file}: ${e.message}`); }
  if (!Array.isArray(data?.pages)) usage(`${file} has no pages array (expected inventory.json from site-structure)`);
  return data.pages
    .filter((r) => r.status === 200 && !r.redirectHops && /html/i.test(r.contentType || '') && !r.canonicalisedTo)
    .map((r) => r.url);
}

// ---------------------------------------------------------------------------
// HTTP and robots.txt: copied from site-structure/scripts/inventory.mjs, which runs its crawl
// on import and so cannot be imported. Keep both in step.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(res, cap = MAX_BODY) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
    size += value.length;
    if (size >= cap) { try { await reader.cancel(); } catch {} break; }
  }
  return Buffer.concat(parts);
}
function errText(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `timeout after ${TIMEOUT / 1000} s`;
  return e?.cause?.code || e?.cause?.message || e?.message || String(e);
}
async function fetchChain(url, ua, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5') {
  const chain = [];
  let cur = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res;
    try {
      res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'user-agent': ua, accept }, signal: AbortSignal.timeout(TIMEOUT) });
    } catch (e) {
      return { chain, finalUrl: cur, status: 0, error: errText(e), headers: new Headers(), body: Buffer.alloc(0) };
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      try { await res.body?.cancel(); } catch {}
      let next;
      try { next = new URL(loc, cur).href; } catch { return { chain, finalUrl: cur, status: res.status, error: 'invalid Location header', headers: res.headers, body: Buffer.alloc(0) }; }
      chain.push({ url: cur, status: res.status });
      if (next === cur || chain.some((c) => c.url === next)) return { chain, finalUrl: next, status: res.status, error: 'redirect loop', headers: res.headers, body: Buffer.alloc(0) };
      if (!/^https?:/.test(next)) return { chain, finalUrl: next, status: res.status, error: 'redirect to a non-http URL', headers: res.headers, body: Buffer.alloc(0) };
      cur = next;
      continue;
    }
    let body;
    try { body = await readBody(res); } catch (e) { return { chain, finalUrl: cur, status: res.status, error: errText(e), headers: res.headers, body: Buffer.alloc(0) }; }
    return { chain, finalUrl: cur, status: res.status, error: null, headers: res.headers, body };
  }
  return { chain, finalUrl: cur, status: 0, error: `more than ${MAX_HOPS} redirects`, headers: new Headers(), body: Buffer.alloc(0) };
}
function decodeBody(buf, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder(charset || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}
function parseRobots(txt) {
  const groups = [];
  let cur = null, lastUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), v = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastUA) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastUA = true;
      continue;
    }
    lastUA = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (v) cur.rules.push({ allow: key === 'allow', path: v }); }
    else if (key === 'crawl-delay') { const n = Number(v); if (Number.isFinite(n) && n >= 0) cur.crawlDelay = n; }
  }
  return { groups };
}
function robotsMatcher(parsed, ua) {
  const token = ua.toLowerCase().split('/')[0].trim();
  const own = parsed.groups.filter((g) => g.agents.some((a) => a !== '*' && (token === a || token.startsWith(a))));
  const star = parsed.groups.filter((g) => g.agents.includes('*'));
  const groups = [...own, ...star];
  const rules = groups.flatMap((g) => g.rules).map((r) => {
    const anchored = r.path.endsWith('$');
    const body = (anchored ? r.path.slice(0, -1) : r.path).split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return { ...r, re: new RegExp(`^${body}${anchored ? '$' : ''}`), len: r.path.length };
  });
  const delays = groups.map((g) => g.crawlDelay).filter((d) => d !== null);
  return {
    crawlDelay: delays.length ? Math.max(...delays) : null,
    rule(url) {
      const u = new URL(url);
      let p = u.pathname + u.search;
      try { p = decodeURI(p); } catch {}
      let best = null;
      for (const r of rules) {
        if (!r.re.test(p) && !r.re.test(u.pathname + u.search)) continue;
        if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r;
      }
      return best && !best.allow ? best.path : null;
    },
  };
}

// ---------------------------------------------------------------------------
// HTML parsing (regex-based, tolerant; content is data, never executed)
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', copy: '©', reg: '®', trade: '™', euro: '€', middot: '·', bull: '•', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ccedil: 'ç' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const textOf = (html) => squash(decodeEntities(String(html).replace(/<[^>]*>/g, ' ')));
// Comparison form: lowercase letters and digits, everything else one space
const norm = (s) => squash(textOf(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' '));
const short = (s, n = 80) => { s = squash(String(s)); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function parseAttrs(s) {
  const out = {};
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s || ''))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
function* tags(html, names) {
  const re = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].toLowerCase();
    if (names.includes(name)) yield { name, attrs: parseAttrs(m[2]) };
  }
}
function elements(html, name) {
  const re = new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
  return [...html.matchAll(re)].map((m) => ({ attrs: parseAttrs(m[1]), inner: m[2] }));
}
// Text of an element including image alt text (accessible name approximation)
const nameOf = (inner) => squash(`${textOf(inner)} ${[...tags(inner, ['img'])].map((t) => t.attrs.alt || '').join(' ')}`);

function parsePage(html, pageUrl) {
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const jsonLd = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]);
  const clean = html.replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const head = /<head\b[\s\S]*?<\/head\s*>/i.exec(clean)?.[0] ?? '';
  const body = head ? clean.replace(head, ' ') : clean;

  let base = pageUrl;
  for (const t of tags(clean, ['base'])) { if (t.attrs.href) { try { base = new URL(t.attrs.href, pageUrl).href; } catch {} } break; }
  const abs = (href) => { try { return new URL(href.trim(), base).href; } catch { return null; } };

  const titles = elements(clean, 'title').map((e) => textOf(e.inner));
  const p = { titles, title: titles[0] ?? null, description: null, robots: [], lang: null, viewport: null, canonicals: [], hreflang: [], og: {} };
  for (const t of tags(clean, ['meta', 'link', 'html'])) {
    if (t.name === 'html' && p.lang === null && 'lang' in t.attrs) p.lang = t.attrs.lang.trim();
    if (t.name === 'meta') {
      const n = (t.attrs.name || '').toLowerCase();
      const prop = (t.attrs.property || '').toLowerCase();
      if (n === 'description' && p.description === null) p.description = squash(t.attrs.content ?? '');
      if (n === 'robots' || n === 'googlebot') p.robots.push(squash(t.attrs.content ?? '').toLowerCase());
      if (n === 'viewport') p.viewport = t.attrs.content ?? '';
      if (/^og:(title|description|image)$/.test(prop) && !(prop in p.og)) p.og[prop] = squash(t.attrs.content ?? '');
    }
    if (t.name === 'link') {
      const rel = (t.attrs.rel || '').toLowerCase().split(/\s+/);
      if (rel.includes('canonical') && t.attrs.href !== undefined) p.canonicals.push({ raw: t.attrs.href.trim(), href: abs(t.attrs.href) });
      if (rel.includes('alternate') && t.attrs.hreflang && t.attrs.href) p.hreflang.push({ lang: t.attrs.hreflang.trim(), href: abs(t.attrs.href) });
    }
  }

  p.headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((m) => ({ level: Number(m[1]), text: nameOf(m[2]) }));
  p.images = [...tags(body, ['img'])].map((t) => {
    let src = t.attrs.src || '';
    if (!src || src.startsWith('data:')) src = t.attrs['data-src'] || t.attrs['data-lazy-src'] || src;
    return { src, hasAlt: 'alt' in t.attrs, width: t.attrs.width, height: t.attrs.height };
  });
  p.links = elements(body, 'a').filter((e) => e.attrs.href !== undefined).map((e) => ({
    href: e.attrs.href.trim(), abs: abs(e.attrs.href), rel: (e.attrs.rel || '').toLowerCase().split(/\s+/),
    text: nameOf(e.inner), label: squash(e.attrs['aria-label'] || ''), title: squash(e.attrs.title || ''),
  }));
  p.jsonLd = jsonLd;
  p.visible = textOf(body);
  // Contact text: footer and address elements, plus tel: links anywhere
  p.contact = [...elements(body, 'footer'), ...elements(body, 'address')].map((e) => textOf(e.inner)).join(' \n ');
  p.telLinks = p.links.filter((l) => /^tel:/i.test(l.href)).map((l) => decodeURIComponent(l.href.slice(4)));
  return p;
}

// ---------------------------------------------------------------------------
// Rich-result requirements (subset). Required: an entry; an array entry means "one of".
// Nested: property -> rule applied to the object values found there.
// Checked against the Google Search Central docs on 2026-11-09; recommended lists are a subset.
// Base: https://developers.google.com/search/docs/appearance/structured-data/
// ---------------------------------------------------------------------------
const RULES = {
  // .../organization: no required properties
  Organization: { recommended: ['name', 'url', 'logo', 'address', ['telephone', 'contactPoint'], 'sameAs'] },
  // .../local-business
  LocalBusiness: {
    required: ['name', 'address'],
    recommended: ['address.streetAddress', 'address.addressLocality', 'address.postalCode', 'address.addressCountry', 'telephone', 'url', 'geo', 'openingHoursSpecification'],
  },
  // https://developers.google.com/search/docs/appearance/site-names (sitelinks search box retired 2024-11)
  WebSite: { required: ['name', 'url'], recommended: ['alternateName'] },
  // .../breadcrumb: ListItem.item is not required on the last item (checked in validateNode)
  BreadcrumbList: { required: ['itemListElement'], nested: { itemListElement: 'ListItem' } },
  ListItem: { required: ['position', ['name', 'item.name']] },
  // .../article: no required properties
  Article: { recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'author.name'] },
  // .../product-snippet (merchant listings add image and priceCurrency as required; not checked)
  Product: { required: ['name', ['review', 'aggregateRating', 'offers']], recommended: ['offers', 'aggregateRating', 'review'], nested: { offers: 'Offer', aggregateRating: 'AggregateRating', review: 'Review' } },
  Offer: { required: [['price', 'priceSpecification.price']], recommended: ['availability', ['priceCurrency', 'priceSpecification.priceCurrency'], 'priceValidUntil'] },
  AggregateOffer: { required: ['lowPrice', 'priceCurrency'], recommended: ['highPrice', 'offerCount'] },
  // .../review-snippet (itemReviewed is left out when nested)
  AggregateRating: { required: ['ratingValue', ['ratingCount', 'reviewCount']], recommended: ['bestRating', 'worstRating'] },
  Review: { required: ['author', 'reviewRating', 'reviewRating.ratingValue'], recommended: ['datePublished'] },
  // .../event (physical events only; online-event properties removed 2025-06)
  Event: { required: ['name', 'startDate', 'location', 'location.address'], recommended: ['description', 'endDate', 'eventStatus', 'image', 'location.name', 'offers', 'organizer', 'performer'] },
  // .../job-posting (fully remote jobs may use applicantLocationRequirements instead of jobLocation)
  JobPosting: {
    required: ['datePosted', 'description', 'hiringOrganization', 'title', ['jobLocation', 'applicantLocationRequirements']],
    recommended: ['baseSalary', 'employmentType', 'identifier', 'validThrough', 'directApply'],
    nested: { jobLocation: 'JobLocation' },
  },
  JobLocation: { required: ['address', 'address.addressCountry'] },
  // .../faqpage was removed: FAQ rich results are no longer shown (Search Central changelog,
  // 2026-05-08 and 2026-06-15). Only the schema.org structure is checked.
  FAQPage: { required: ['mainEntity'], nested: { mainEntity: 'Question' } },
  Question: { required: ['name', 'acceptedAnswer', 'acceptedAnswer.text'] },
  // .../video
  VideoObject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: [['contentUrl', 'embedUrl'], 'description', 'duration'] },
  // .../profile-page: requirements of ProfilePage.mainEntity; there is no stand-alone Person result
  Person: { required: [['name', 'alternateName']], recommended: ['description', 'image', 'sameAs'] },
  ProfilePage: { required: ['mainEntity'], recommended: ['dateCreated', 'dateModified'], nested: { mainEntity: 'Person' } },
};

const LOCAL_BUSINESS_TYPES = new Set(['LocalBusiness', 'AnimalShelter', 'ArchiveOrganization', 'AutomotiveBusiness', 'AutoRepair', 'AutoDealer', 'ChildCare', 'Dentist', 'DryCleaningOrLaundry', 'EmergencyService', 'EmploymentAgency', 'EntertainmentBusiness', 'FinancialService', 'AccountingService', 'BankOrCreditUnion', 'InsuranceAgency', 'FoodEstablishment', 'Bakery', 'BarOrPub', 'CafeOrCoffeeShop', 'FastFoodRestaurant', 'Restaurant', 'GovernmentOffice', 'HealthAndBeautyBusiness', 'BeautySalon', 'HairSalon', 'DaySpa', 'HomeAndConstructionBusiness', 'Electrician', 'GeneralContractor', 'HVACBusiness', 'HousePainter', 'Locksmith', 'MovingCompany', 'Plumber', 'RoofingContractor', 'InternetCafe', 'LegalService', 'Attorney', 'Notary', 'Library', 'LodgingBusiness', 'Hotel', 'BedAndBreakfast', 'Hostel', 'Motel', 'MedicalBusiness', 'MedicalClinic', 'Optician', 'Pharmacy', 'Physician', 'ProfessionalService', 'RadioStation', 'RealEstateAgent', 'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'SportsActivityLocation', 'Store', 'ClothingStore', 'ComputerStore', 'ElectronicsStore', 'FurnitureStore', 'GroceryStore', 'HardwareStore', 'TelevisionStation', 'TouristInformationCenter', 'TravelAgency']);
const ORGANIZATION_TYPES = new Set(['Organization', 'Corporation', 'NGO', 'EducationalOrganization', 'GovernmentOrganization', 'MedicalOrganization', 'OnlineBusiness', 'OnlineStore', 'NewsMediaOrganization', 'SportsOrganization', 'PerformingGroup', 'Airline', 'Consortium', 'FundingScheme', 'LibrarySystem', 'ResearchOrganization', 'WorkersUnion', 'Cooperative', 'PoliticalParty', 'Project']);
const EVENT_TYPES = new Set(['Event', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance', 'DanceEvent', 'DeliveryEvent', 'EducationEvent', 'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent', 'MusicEvent', 'PublicationEvent', 'SaleEvent', 'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent']);
const ARTICLE_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting']);

const typesOf = (n) => (Array.isArray(n?.['@type']) ? n['@type'] : n?.['@type'] ? [n['@type']] : [])
  .filter((t) => typeof t === 'string').map((t) => t.replace(/^https?:\/\/schema\.org\//, ''));
function ruleKey(n) {
  const ts = typesOf(n);
  if (ts.some((t) => LOCAL_BUSINESS_TYPES.has(t))) return 'LocalBusiness';
  if (ts.some((t) => ORGANIZATION_TYPES.has(t))) return 'Organization';
  if (ts.some((t) => ARTICLE_TYPES.has(t))) return 'Article';
  if (ts.some((t) => EVENT_TYPES.has(t))) return 'Event';
  for (const k of ['WebSite', 'BreadcrumbList', 'Product', 'JobPosting', 'FAQPage', 'VideoObject', 'ProfilePage', 'Person']) if (ts.includes(k)) return k;
  return null;
}

// Top-level nodes (block roots and @graph members) and an @id index over every object
function collectNodes(blocks) {
  const top = [];
  const ids = new Map();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const id = v['@id'];
    if (typeof id === 'string' && Object.keys(v).some((k) => k !== '@id')) ids.set(id, { ...(ids.get(id) || {}), ...v });
    for (const x of Object.values(v)) if (typeof x === 'object') walk(x);
  };
  for (const b of blocks) {
    walk(b.data);
    const roots = Array.isArray(b.data) ? b.data : [b.data];
    for (const r of roots) {
      if (!r || typeof r !== 'object') continue;
      if (Array.isArray(r['@graph'])) for (const g of r['@graph']) top.push({ node: g, block: b.index });
      if (r['@type']) top.push({ node: r, block: b.index });
    }
  }
  const deref = (v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v['@id'] === 'string' && Object.keys(v).length === 1 && ids.has(v['@id']) ? ids.get(v['@id']) : v);
  return { top: top.map((t) => ({ ...t, node: deref(t.node) })), deref };
}
function getPath(node, p, deref) {
  let cur = [node];
  for (const seg of p.split('.')) {
    const next = [];
    for (const c of cur) {
      const o = deref(c);
      if (!o || typeof o !== 'object') continue;
      const v = o[seg];
      for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && x !== null) next.push(deref(x));
    }
    cur = next;
  }
  return cur.filter((v) => !(v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));
}
function validateNode(node, key, deref, where, out, depth = 0) {
  if (key === 'Offer' && typesOf(node).includes('AggregateOffer')) key = 'AggregateOffer';
  const rule = RULES[key];
  if (!rule || depth > 3) return;
  const has = (p) => getPath(node, p, deref).length > 0;
  if (key === 'BreadcrumbList') {
    const items = getPath(node, 'itemListElement', deref);
    items.slice(0, -1).forEach((it, i) => { if (!getPath(it, 'item', deref).length) out.push(['error', 'jsonld-required', `${where} > itemListElement[${i}]: ListItem is missing required item (only the last item may omit it)`]); });
  }
  for (const req of rule.required || []) {
    if (Array.isArray(req)) { if (!req.some(has)) out.push(['error', 'jsonld-required', `${where}: ${key} needs one of ${req.join(', ')}`]); }
    else if (!has(req)) out.push(['error', 'jsonld-required', `${where}: ${key} is missing required ${req}`]);
  }
  const missingRec = (rule.recommended || []).filter((r) => (Array.isArray(r) ? !r.some(has) : !has(r))).map((r) => (Array.isArray(r) ? r.join('|') : r));
  if (missingRec.length) out.push(['info', 'jsonld-recommended', `${where}: ${key} lacks recommended ${missingRec.join(', ')}`]);
  for (const [prop, sub] of Object.entries(rule.nested || {})) {
    getPath(node, prop, deref).filter((v) => v && typeof v === 'object').forEach((v, i, all) => validateNode(v, sub, deref, `${where} > ${prop}${all.length > 1 ? `[${i}]` : ''}`, out, depth + 1));
  }
}

// ---------------------------------------------------------------------------
// Visible-text matching for structured-data claims
// ---------------------------------------------------------------------------
function textVisible(value, visibleNorm) {
  const v = norm(value);
  if (!v) return true;
  if (visibleNorm.includes(v)) return true;
  // Long text (answers, descriptions): accept when 80 % of its word trigrams appear
  const w = v.split(' ');
  if (w.length < 25) return false;
  let hit = 0, total = 0;
  for (let i = 0; i + 3 <= w.length; i++) { total++; if (visibleNorm.includes(w.slice(i, i + 3).join(' '))) hit++; }
  return hit / total >= 0.8;
}
// Numbers in visible text, read as both 1,234.56 and 1.234,56
function visibleNumbers(text) {
  const out = new Set();
  for (const m of text.matchAll(/\d[\d.,'\u00a0\u202f ]*\d|\d/g)) {
    const raw = m[0].replace(/[\s'\u00a0\u202f]/g, '');
    for (const [th, dec] of [[',', '.'], ['.', ',']]) {
      const s = raw.split(th).join('').replace(dec, '.');
      const n = Number(s);
      if (Number.isFinite(n)) out.add(Math.round(n * 100) / 100);
    }
    for (const part of raw.split(/[.,]/)) if (part) out.add(Number(part));
  }
  return out;
}
const numVisible = (value, nums) => { const n = Number(String(value).replace(',', '.')); return !Number.isFinite(n) || nums.has(Math.round(n * 100) / 100); };
const MONTHS = {
  de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
};
function dateVisible(iso, visibleLower) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return true;
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
  const dd = String(d).padStart(2, '0'), mm = String(mo).padStart(2, '0');
  const cands = [`${y}-${mm}-${dd}`, `${d}.${mo}.`, `${dd}.${mm}.`, `${d}.${mm}.`, `${dd}.${mo}.`, `${mo}/${d}/${y}`, `${mm}/${dd}/${y}`, `${d}/${mo}/${y}`, `${dd}/${mm}/${y}`];
  for (const names of Object.values(MONTHS)) {
    const full = names[mo - 1], abbr = full.slice(0, 3);
    cands.push(`${d}. ${full}`, `${d}. ${abbr}`, `${d} ${full}`, `${d} ${abbr}`, `${full} ${d}`, `${abbr} ${d}`, `${abbr}. ${d}`);
  }
  const t = visibleLower.replace(/\s+/g, ' ');
  return cands.some((c) => {
    const i = t.indexOf(c);
    if (i < 0) return false;
    const before = t[i - 1], after = t[i + c.length];
    return !(before && /\d/.test(before)) && !(after && /\d/.test(after) && !c.endsWith('.'));
  });
}

// ---------------------------------------------------------------------------
// Brand profile: name from the front matter, phones and addresses from the Facts table
// ---------------------------------------------------------------------------
// Digits without leading zeros; numbers match when one ends with the other and the rest is at
// most a country code (+49 7721 … equals 07721 …)
const phoneKey = (s) => String(s).replace(/\D/g, '').replace(/^0+/, '');
const samePhone = (a, b) => {
  const [x, y] = [phoneKey(a), phoneKey(b)].sort((p, q) => q.length - p.length);
  return y.length >= 6 && x.endsWith(y) && x.length - y.length <= 3;
};
const streetKey = (s) => norm(String(s).replace(/stra(ß|ss)e\b/gi, 'str').replace(/\bstr\./gi, 'str')).replace(/\s+/g, '');
const STREET_RE = /([\p{L}][\p{L}.\- ]{1,40}?(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|steig|pfad|markt|road|street|avenue|lane|drive|way)\s+\d+\s?[a-z]?)\b/giu;
const POSTAL_RE = /\b(\d{5})\s+([\p{Lu}][\p{L}\-]+)/gu;
const PHONE_LABEL_RE = /(?:telefon|tel|fon|phone|mobil|mobile|handy)\.?\s*:?\s*((?:\+|00|0)[\d\s/().\-–]{5,}\d)/gi;

function readBrand(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const brand = { file, name: null, phones: [], streets: [], postals: [] };
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
  if (fm) {
    const m = /^name:\s*(?:"([^"]*)"|'([^']*)'|([^#\r\n]*))/m.exec(fm[1]);
    const name = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
    if (name) brand.name = name;
  }
  const facts = /^##\s+Facts\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(txt)?.[1] ?? '';
  for (const line of facts.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line) || /^\s*\|\s*-{3}/.test(line)) continue;
    const fact = line.split('|')[1]?.trim() ?? '';
    if (!fact || /^fact$/i.test(fact)) continue;
    const labelPhone = /\b(telefon|tel|phone|fon|mobil|mobile)\b/i.test(fact);
    if (/\b(fax|telefax)\b/i.test(fact) && !labelPhone) continue;
    for (const m of fact.matchAll(/(?:\+|00|0)\d[\d\s/().\-–]{4,}\d/g)) {
      if (labelPhone || /^(\+|00)/.test(m[0])) brand.phones.push(squash(m[0]));
    }
    for (const m of fact.matchAll(STREET_RE)) brand.streets.push(squash(m[1]));
    for (const m of fact.matchAll(POSTAL_RE)) brand.postals.push(m[1]);
  }
  for (const k of ['phones', 'streets', 'postals']) brand[k] = [...new Set(brand[k])];
  return brand;
}
const nameKey = (s) => norm(s).replace(/\b(gmbh|co|kg|ag|ug|mbh|e k|ek|ohg|gbr|ltd|llc|inc|se|haftungsbeschränkt)\b/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Checks per page
// ---------------------------------------------------------------------------
const GENERIC_ANCHORS = new Set(['hier', 'mehr', 'weiter', 'weiterlesen', 'mehr lesen', 'mehr erfahren', 'hier klicken', 'klicken sie hier', 'details', 'link', 'click here', 'here', 'read more', 'more', 'learn more', 'click', 'this']);
const GENERIC_TITLES = new Set(['home', 'homepage', 'startseite', 'start', 'welcome', 'willkommen', 'index', 'untitled', 'page', 'seite', 'neue seite', 'new page', 'blog']);
const NOISE_TOKENS = new Set(['img', 'image', 'dsc', 'dcim', 'pxl', 'photo', 'foto', 'pic', 'screenshot', 'scaled', 'whatsapp', 'jpeg', 'jpg', 'png', 'webp', 'avif', 'gif', 'svg', 'min', 'copy', 'kopie', 'edited', 'final']);
const LANG_RE = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i;

const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');
const urlKey = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };

function checkPage(pg, ctx) {
  const F = (severity, check, detail) => pg.findings.push({ url: pg.url, check, severity, detail });
  const p = pg.parsed;
  const final = new URL(pg.finalUrl);

  // Head
  if (!p.title) F('error', 'missing-title', 'no <title> or an empty one');
  else {
    if (p.title.length < 15 || p.title.length > 60) F('info', 'title-length', `${p.title.length} characters (15–60 suggested): "${short(p.title)}"`);
  }
  if (p.titles.length > 1) F('warn', 'multiple-title', `${p.titles.length} <title> elements`);
  if (!p.description) F('warn', 'missing-description', 'no meta description');
  else if (p.description.length < 50 || p.description.length > 160) F('info', 'description-length', `${p.description.length} characters (50–160 suggested)`);
  const h1s = p.headings.filter((h) => h.level === 1);
  if (!h1s.length) F('warn', 'missing-h1', 'no <h1>');
  if (h1s.length > 1) F('warn', 'multiple-h1', `${h1s.length} <h1> elements: ${h1s.slice(0, 3).map((h) => `"${short(h.text, 40)}"`).join(', ')}`);
  if (h1s.length && p.title) {
    const h = norm(h1s[0].text), t = norm(p.title);
    if (h && h === t && (GENERIC_TITLES.has(h) || (ctx.brand?.name && nameKey(h) === nameKey(ctx.brand.name)))) F('warn', 'h1-title-generic', `H1 and title are both "${short(p.title)}"; neither says what the page is about`);
  }
  if (!p.canonicals.length) F('warn', 'missing-canonical', 'no <link rel="canonical">');
  else {
    if (p.canonicals.length > 1 && new Set(p.canonicals.map((c) => c.href)).size > 1) F('error', 'multiple-canonical', `${p.canonicals.length} different canonical tags: ${p.canonicals.map((c) => c.raw).join(', ')}`);
    const c = p.canonicals[0];
    if (!/^https?:\/\//i.test(c.raw)) F('warn', 'canonical-relative', `canonical is not absolute: "${c.raw}"`);
    if (c.href && urlKey(c.href) !== urlKey(pg.finalUrl)) {
      if (final.search) F('info', 'canonical-other', `parameter URL points its canonical to ${c.href}`);
      else F('warn', 'canonical-other', `canonical points to ${c.href}; only right for a duplicate of that page, otherwise this page asks not to be indexed`);
    }
  }
  const robots = p.robots.join(', ');
  if (/\b(noindex|none)\b/.test(robots) || /\b(noindex|none)\b/i.test(pg.xRobotsTag || '')) F('warn', 'noindex', `noindex set (${[robots, pg.xRobotsTag && `X-Robots-Tag: ${pg.xRobotsTag}`].filter(Boolean).join('; ')})`);
  if (/\bnofollow\b/.test(robots) || /\bnofollow\b/i.test(pg.xRobotsTag || '')) F('warn', 'nofollow', 'meta robots nofollow: links on this page pass no signals');
  if (!p.lang) F('warn', 'missing-lang', 'no lang attribute on <html>');
  else if (!LANG_RE.test(p.lang)) F('warn', 'invalid-lang', `lang="${p.lang}" is not a BCP 47 language tag`);
  if (p.viewport === null) F('warn', 'missing-viewport', 'no <meta name="viewport">');
  const ogMissing = ['og:title', 'og:description', 'og:image'].filter((k) => !p.og[k]);
  if (ogMissing.length) F('info', 'open-graph', `missing ${ogMissing.join(', ')}`);

  // hreflang (reciprocity is checked across pages later)
  if (p.hreflang.length) {
    const bad = p.hreflang.filter((h) => h.lang.toLowerCase() !== 'x-default' && !LANG_RE.test(h.lang));
    if (bad.length) F('error', 'hreflang-code', `invalid hreflang value(s): ${bad.map((h) => h.lang).join(', ')}`);
    if (!p.hreflang.some((h) => h.lang.toLowerCase() === 'x-default')) F('info', 'hreflang-x-default', 'no x-default alternate');
    if (!p.hreflang.some((h) => urlKey(h.href) === urlKey(pg.finalUrl))) F('warn', 'hreflang-self', 'the hreflang set does not include this page itself');
    const byLang = new Map();
    for (const h of p.hreflang) { const k = h.lang.toLowerCase(); if (!byLang.has(k)) byLang.set(k, new Set()); byLang.get(k).add(urlKey(h.href)); }
    const conflicts = [...byLang].filter(([, s]) => s.size > 1).map(([k]) => k);
    if (conflicts.length) F('error', 'hreflang-conflict', `same hreflang for different URLs: ${conflicts.join(', ')}`);
  }

  // Headings
  let prev = 0;
  for (const h of p.headings) {
    if (prev && h.level > prev + 1) F('warn', 'heading-skip', `h${prev} → h${h.level} ("${short(h.text, 50)}")`);
    if (!h.text) F('warn', 'empty-heading', `empty <h${h.level}>`);
    prev = h.level;
  }

  // Images
  const noAlt = p.images.filter((i) => !i.hasAlt);
  if (noAlt.length) F('error', 'image-alt', `${noAlt.length} image(s) without alt attribute: ${noAlt.slice(0, EXAMPLES).map((i) => short(i.src || '(no src)', 60)).join(', ')}`);
  const noSize = p.images.filter((i) => !i.width || !i.height);
  if (noSize.length) F('info', 'image-dimensions', `${noSize.length} image(s) without width and height: ${noSize.slice(0, EXAMPLES).map((i) => short(i.src || '(no src)', 60)).join(', ')}`);
  const wordless = p.images.filter((i) => {
    if (!i.src || i.src.startsWith('data:')) return false;
    let base;
    try { base = decodeURIComponent(new URL(i.src, pg.finalUrl).pathname.split('/').pop()); } catch { return false; }
    base = base.replace(/\.[a-z0-9]+$/i, '');
    if (base.length < 8) return false;
    const words = (base.match(/\p{L}+/gu) || []).filter((w) => w.length >= 3 && /[aeiouyäöü]/i.test(w) && !NOISE_TOKENS.has(w.toLowerCase()));
    return !words.length;
  });
  if (wordless.length) F('info', 'image-filename', `${wordless.length} image file name(s) without words: ${wordless.slice(0, EXAMPLES).map((i) => short(i.src, 60)).join(', ')}`);

  // Links
  const nofollowInternal = [], insecure = [], empty = [], generic = [];
  for (const l of p.links) {
    let u = null;
    try { u = l.abs ? new URL(l.abs) : null; } catch {}
    const isHttp = u && /^https?:$/.test(u.protocol);
    if (isHttp && sameSite(u.hostname, final.hostname) && l.rel.includes('nofollow')) nofollowInternal.push(l.href);
    if (final.protocol === 'https:' && u?.protocol === 'http:') insecure.push(l.href);
    const name = l.label || l.text;
    if (!name && !l.title) empty.push(l.href || '(empty href)');
    else if (name && GENERIC_ANCHORS.has(norm(name))) generic.push(`"${short(name, 30)}" → ${short(l.href, 60)}`);
  }
  const ex = (a) => `${a.slice(0, EXAMPLES).join(', ')}${a.length > EXAMPLES ? ', …' : ''}`;
  if (nofollowInternal.length) F('warn', 'internal-nofollow', `${nofollowInternal.length} internal link(s) with rel=nofollow: ${ex(nofollowInternal)}`);
  if (insecure.length) F('warn', 'insecure-link', `${insecure.length} link(s) to http:// from an https page: ${ex(insecure)}`);
  if (empty.length) F('error', 'empty-anchor', `${empty.length} link(s) without text, alt or aria-label: ${ex(empty)}`);
  if (generic.length) F('warn', 'generic-anchor', `${generic.length} link(s) with generic text: ${ex(generic)}`);

  // Structured data
  const blocks = [];
  p.jsonLd.forEach((raw, i) => {
    const txt = raw.trim();
    if (!txt) { F('warn', 'jsonld-empty', `block ${i + 1} is empty`); return; }
    try { blocks.push({ index: i + 1, data: JSON.parse(txt) }); }
    catch (e) { F('error', 'jsonld-syntax', `block ${i + 1}: ${e.message}`); }
  });
  const { top, deref } = collectNodes(blocks);
  pg.jsonLdTypes = [...new Set(top.flatMap((t) => typesOf(t.node)))];
  const out = [];
  for (const { node, block } of top) {
    const key = ruleKey(node);
    if (!key) continue;
    const label = `block ${block} ${typesOf(node).join('/')}${node.name && typeof node.name === 'string' ? ` "${short(node.name, 40)}"` : ''}`;
    validateNode(node, key, deref, label, out);
    if (key === 'FAQPage') out.push(['info', 'jsonld-faq-eligibility', `${label}: Google no longer shows FAQ rich results (retired 2026; before that only for government and health sites); structure checked only`]);
  }
  for (const [s, c, d] of out) F(s, c, d);

  // Consistency: structured data claims must be visible
  const visNorm = ` ${norm(p.visible)} `;
  const visLower = p.visible.toLowerCase();
  const nums = visibleNumbers(p.visible);
  const invisible = (what, value) => F('error', 'jsonld-not-visible', `${what} not found in visible text: "${short(textOf(value), 70)}"`);
  const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
  for (const { node } of top) {
    const key = ruleKey(node);
    const g = (p2) => getPath(node, p2, deref);
    if (key === 'FAQPage') {
      for (const q of g('mainEntity')) {
        const qn = str(deref(q)?.name);
        if (qn && !textVisible(qn, visNorm)) invisible('FAQ question', qn);
        for (const a of getPath(q, 'acceptedAnswer.text', deref).map(str).filter(Boolean)) if (!textVisible(a, visNorm)) invisible('FAQ answer', a);
      }
    }
    if (key === 'Product') {
      for (const n of g('name').map(str).filter(Boolean)) if (!textVisible(n, visNorm)) invisible('product name', n);
      for (const pr of [...g('offers.price'), ...g('offers.lowPrice'), ...g('offers.priceSpecification.price')].map(str).filter(Boolean)) if (!numVisible(pr, nums)) invisible('product price', pr);
    }
    if (key === 'Product' || key === 'LocalBusiness' || key === 'Organization') {
      for (const r of g('aggregateRating.ratingValue').map(str).filter(Boolean)) if (!numVisible(r, nums)) invisible('aggregateRating ratingValue', r);
      for (const r of [...g('aggregateRating.reviewCount'), ...g('aggregateRating.ratingCount')].map(str).filter(Boolean)) if (!numVisible(r, nums)) invisible('aggregateRating count', r);
    }
    if (key === 'Event') for (const d of g('startDate').map(str).filter(Boolean)) if (!dateVisible(d, visLower)) invisible('event startDate', d);
    if (key === 'JobPosting') for (const t of g('title').map(str).filter(Boolean)) if (!textVisible(t, visNorm)) invisible('job title', t);
    if (key === 'BreadcrumbList') {
      for (const it of g('itemListElement')) {
        const n = str(deref(it)?.name) ?? str(getPath(it, 'item.name', deref)[0]);
        if (n && !textVisible(n, visNorm)) invisible('breadcrumb name', n);
      }
    }
  }

  // Consistency: name, address, phone against the brand profile
  const b = ctx.brand;
  if (b) {
    const mismatch = (where, field, found, expected) => F('warn', 'nap-mismatch', `${where} ${field} "${found}" differs from brand profile "${expected}"`);
    for (const { node } of top) {
      const key = ruleKey(node);
      if (key !== 'LocalBusiness' && key !== 'Organization') continue;
      const where = `JSON-LD ${typesOf(node).join('/')}`;
      const nm = str(node.name);
      if (b.name && nm && !nameKey(nm).includes(nameKey(b.name)) && !nameKey(b.name).includes(nameKey(nm))) mismatch(where, 'name', nm, b.name);
      if (b.phones.length) for (const t of getPath(node, 'telephone', deref).map(str).filter(Boolean)) if (!b.phones.some((x) => samePhone(x, t))) mismatch(where, 'telephone', t, b.phones.join(' / '));
      if (b.streets.length) for (const s of getPath(node, 'address.streetAddress', deref).map(str).filter(Boolean)) if (!b.streets.some((x) => streetKey(s).includes(streetKey(x)))) mismatch(where, 'streetAddress', s, b.streets.join(' / '));
      if (b.postals.length) for (const s of getPath(node, 'address.postalCode', deref).map(str).filter(Boolean)) if (!b.postals.includes(s.trim())) mismatch(where, 'postalCode', s, b.postals.join(' / '));
    }
    const contactPhones = [...p.telLinks, ...[...p.contact.matchAll(PHONE_LABEL_RE)].map((m) => m[1])].map(squash);
    if (b.phones.length) {
      const seen = new Set();
      for (const t of contactPhones) {
        const k = phoneKey(t);
        if (k.length < 6 || seen.has(k)) continue;
        seen.add(k);
        if (!b.phones.some((x) => samePhone(x, t))) mismatch('footer/contact', 'phone', t, b.phones.join(' / '));
      }
    }
    if (b.streets.length) {
      const found = [...new Set([...p.contact.matchAll(STREET_RE)].map((m) => squash(m[1])))];
      if (found.length && !found.some((s) => b.streets.some((x) => streetKey(s).includes(streetKey(x))))) mismatch('footer/contact', 'street', found.join(' / '), b.streets.join(' / '));
    }
    if (b.postals.length) {
      const found = [...new Set([...p.contact.matchAll(POSTAL_RE)].map((m) => m[1]))];
      if (found.length && !found.some((s) => b.postals.includes(s))) mismatch('footer/contact', 'postal code', found.join(' / '), b.postals.join(' / '));
    }
  }
}

// Checks across all fetched pages: duplicates, hreflang return links, canonical targets
function checkAcross(pages) {
  const ok = pages.filter((pg) => pg.parsed);
  const byFinal = new Map(ok.map((pg) => [urlKey(pg.finalUrl), pg]));
  const unique = [...byFinal.values()];
  const indexable = unique.filter((pg) => !pg.noindex);
  for (const [field, check, label] of [['title', 'duplicate-title', 'title'], ['description', 'duplicate-description', 'meta description']]) {
    const groups = new Map();
    for (const pg of indexable) {
      const v = (pg.parsed[field] || '').trim().toLowerCase();
      if (!v) continue;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(pg);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (const pg of g) pg.findings.push({ url: pg.url, check, severity: 'warn', detail: `same ${label} as ${g.filter((x) => x !== pg).map((x) => x.finalUrl).join(', ')}` });
    }
  }
  for (const pg of unique) {
    const unchecked = [];
    for (const h of pg.parsed.hreflang) {
      const k = urlKey(h.href);
      if (k === urlKey(pg.finalUrl)) continue;
      const other = byFinal.get(k);
      if (!other) { unchecked.push(h.href); continue; }
      if (!other.parsed.hreflang.some((x) => urlKey(x.href) === urlKey(pg.finalUrl))) pg.findings.push({ url: pg.url, check: 'hreflang-return', severity: 'error', detail: `${h.lang} → ${h.href} has no hreflang link back to this page` });
    }
    if (unchecked.length) pg.findings.push({ url: pg.url, check: 'hreflang-unchecked', severity: 'info', detail: `${unchecked.length} alternate(s) not in this run, return links not verified: ${unchecked.slice(0, EXAMPLES).join(', ')}` });
    const c = pg.parsed.canonicals[0]?.href;
    if (c && urlKey(c) !== urlKey(pg.finalUrl)) {
      const target = pages.find((x) => urlKey(x.url) === urlKey(c) || urlKey(x.finalUrl) === urlKey(c));
      if (target && (target.status !== 200 || target.noindex || target.chain.length)) pg.findings.push({ url: pg.url, check: 'canonical-target', severity: 'error', detail: `canonical target ${c} is ${target.status !== 200 ? `HTTP ${target.status || target.error}` : target.chain.length ? 'a redirect' : 'noindex'}` });
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const GROUPS = [
  ['Indexability', ['status', 'redirect', 'robots-txt', 'noindex', 'nofollow', 'canonical-target', 'not-html']],
  ['Head', ['missing-title', 'multiple-title', 'title-length', 'duplicate-title', 'missing-description', 'description-length', 'duplicate-description', 'missing-h1', 'multiple-h1', 'h1-title-generic', 'missing-canonical', 'multiple-canonical', 'canonical-relative', 'canonical-other', 'missing-lang', 'invalid-lang', 'missing-viewport', 'open-graph']],
  ['hreflang', ['hreflang-code', 'hreflang-x-default', 'hreflang-self', 'hreflang-conflict', 'hreflang-return', 'hreflang-unchecked']],
  ['Headings', ['heading-skip', 'empty-heading']],
  ['Images', ['image-alt', 'image-dimensions', 'image-filename']],
  ['Links', ['internal-nofollow', 'insecure-link', 'empty-anchor', 'generic-anchor']],
  ['Structured data', ['jsonld-syntax', 'jsonld-empty', 'jsonld-required', 'jsonld-recommended', 'jsonld-faq-eligibility']],
  ['Consistency', ['jsonld-not-visible', 'nap-mismatch']],
];
const groupOf = (check) => GROUPS.find(([, cs]) => cs.includes(check))?.[0] ?? 'Other';
const SEV_ORDER = { error: 0, warn: 1, info: 2 };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let urls = [...args.urls];
  if (args.inventory) urls.push(...urlsFromInventory(args.inventory));
  urls = [...new Set(urls.map(urlKey))];
  const skippedByMax = urls.length > args.max ? urls.length - args.max : 0;
  urls = urls.slice(0, args.max);
  if (!urls.length) usage('no URLs to check');

  const data = findDataFolder(process.cwd());
  let brandFile = args.brand;
  if (brandFile === undefined) brandFile = data && fs.existsSync(path.join(data, 'brand.md')) ? path.join(data, 'brand.md') : null;
  let brand = null;
  if (brandFile) {
    try { brand = readBrand(brandFile); } catch (e) { usage(`cannot read brand profile ${brandFile}: ${e.message}`); }
  }

  const robotsByOrigin = new Map();
  const robotsFor = async (u) => {
    const origin = new URL(u).origin;
    if (!robotsByOrigin.has(origin)) {
      const r = await fetchChain(`${origin}/robots.txt`, args.ua, 'text/plain,*/*;q=0.5');
      const parsed = r.status === 200 ? parseRobots(decodeBody(r.body, r.headers.get('content-type'))) : { groups: [] };
      robotsByOrigin.set(origin, { found: r.status === 200, status: r.status, matcher: robotsMatcher(parsed, args.ua) });
    }
    return robotsByOrigin.get(origin);
  };

  const pages = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const pg = { url, finalUrl: url, status: null, error: null, chain: [], contentType: null, xRobotsTag: null, robotsDisallow: null, noindex: false, canonical: null, title: null, jsonLdTypes: [], parsed: null, findings: [] };
    pages.push(pg);
    const F = (severity, check, detail) => pg.findings.push({ url, check, severity, detail });
    const rb = await robotsFor(url);
    pg.robotsDisallow = rb.matcher.rule(url);
    if (pg.robotsDisallow) { F('warn', 'robots-txt', `disallowed by robots.txt (${pg.robotsDisallow}); not fetched`); continue; }
    const delay = Math.min(Math.max(args.delay, (rb.matcher.crawlDelay ?? 0) * 1000), 10000);
    if (i > 0 && delay) await sleep(delay);
    const res = await fetchChain(url, args.ua);
    Object.assign(pg, { finalUrl: res.finalUrl, status: res.status, error: res.error, chain: res.chain, contentType: res.headers.get('content-type'), xRobotsTag: res.headers.get('x-robots-tag') });
    if (res.chain.length) F('info', 'redirect', `${res.chain.length} redirect(s): ${[...res.chain.map((c) => `${c.url} (${c.status})`), res.finalUrl].join(' → ')}`);
    if (res.error || res.status !== 200) { F('error', 'status', res.error ? `fetch failed: ${res.error}` : `HTTP ${res.status}`); continue; }
    if (!/html/i.test(pg.contentType || '')) { F('warn', 'not-html', `content type ${pg.contentType || 'missing'}`); continue; }
    if (res.chain.length) {
      const fr = await robotsFor(res.finalUrl);
      const d = fr.matcher.rule(res.finalUrl);
      if (d) { pg.robotsDisallow = d; F('warn', 'robots-txt', `redirect target disallowed by robots.txt (${d})`); }
    }
    pg.parsed = parsePage(decodeBody(res.body, pg.contentType), res.finalUrl);
    pg.title = pg.parsed.title;
    pg.canonical = pg.parsed.canonicals[0]?.href ?? null;
    pg.noindex = /\b(noindex|none)\b/.test(pg.parsed.robots.join(' ')) || /\b(noindex|none)\b/i.test(pg.xRobotsTag || '');
    checkPage(pg, { brand });
  }
  checkAcross(pages);

  const findings = pages.flatMap((pg) => pg.findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]));
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const summary = { pages: pages.length, fetched: pages.filter((p) => p.parsed).length, error: count('error'), warn: count('warn'), info: count('info'), skippedByMax };
  const byCheck = {};
  for (const f of findings) byCheck[`${f.severity} ${f.check}`] = (byCheck[`${f.severity} ${f.check}`] || 0) + 1;
  summary.byCheck = byCheck;
  const generatedAt = new Date().toISOString();
  const pageRows = pages.map((pg) => ({
    url: pg.url, finalUrl: pg.finalUrl, status: pg.status, error: pg.error, redirects: pg.chain, canonical: pg.canonical,
    canonicalSelf: pg.canonical ? urlKey(pg.canonical) === urlKey(pg.finalUrl) : null, noindex: pg.noindex,
    robotsDisallow: pg.robotsDisallow, title: pg.title, jsonLdTypes: pg.jsonLdTypes,
  }));
  const json = {
    tool: 'seo-check', version: VERSION, generatedAt,
    options: { max: args.max, delay: args.delay, userAgent: args.ua, inventory: args.inventory },
    brand: brand ? { file: brand.file, name: brand.name, phones: brand.phones, streets: brand.streets, postalCodes: brand.postals } : null,
    summary, pages: pageRows, findings: findings.map(({ url, check, severity, detail }) => ({ url, check, severity, detail })),
  };

  const md = report(json, true);
  let outDir = args.out;
  if (outDir === undefined) outDir = data ? path.join(data, 'reports', `${localDate()}-seo`) : null;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'report.md'), md);
    fs.writeFileSync(path.join(outDir, 'seo-check.json'), `${JSON.stringify({ ...json, outDir }, null, 2)}\n`);
  }
  if (args.format === 'json') process.stdout.write(`${JSON.stringify({ ...json, outDir }, null, 2)}\n`);
  else if (args.format === 'md') process.stdout.write(md);
  else process.stdout.write(report(json, false));
  process.stderr.write(`seo-check: ${summary.pages} page(s), ${summary.error} error(s), ${summary.warn} warning(s), ${summary.info} info${outDir ? `; wrote ${outDir}` : ''}\n`);
  process.exit(summary.error ? 1 : 0);
}

function report(json, markdown) {
  const L = [];
  const esc = (s) => (markdown ? String(s).replace(/\|/g, '\\|').replace(/([*_`<>[\]])/g, '\\$1') : String(s));
  const s = json.summary;
  L.push(markdown ? '# SEO check' : 'SEO check', '');
  L.push(`${markdown ? '- ' : ''}Generated: ${json.generatedAt}`);
  L.push(`${markdown ? '- ' : ''}Pages: ${s.pages} (${s.fetched} parsed)${s.skippedByMax ? `, ${s.skippedByMax} skipped by --max` : ''}`);
  L.push(`${markdown ? '- ' : ''}Findings: ${s.error} error(s), ${s.warn} warning(s), ${s.info} info`);
  L.push(`${markdown ? '- ' : ''}Brand profile: ${json.brand ? `${json.brand.file} (name ${json.brand.name ? `"${json.brand.name}"` : 'empty'}, ${json.brand.phones.length} phone(s), ${json.brand.streets.length} street(s), ${json.brand.postalCodes.length} postal code(s))` : 'none'}`);
  L.push('');
  for (const pg of json.pages) {
    const idx = pg.robotsDisallow ? `robots.txt disallow ${pg.robotsDisallow}` : [
      pg.error ? `error ${pg.error}` : `HTTP ${pg.status}`,
      pg.redirects.length ? `${pg.redirects.length} redirect(s) to ${pg.finalUrl}` : null,
      pg.canonical ? (pg.canonicalSelf ? 'canonical self' : `canonical ${pg.canonical}`) : (pg.status === 200 ? 'no canonical' : null),
      pg.noindex ? 'noindex' : (pg.status === 200 ? 'indexable' : null),
    ].filter(Boolean).join(', ');
    L.push(markdown ? `## ${esc(pg.url)}` : pg.url, '', `${markdown ? '' : '  '}${markdown ? `_${esc(idx)}_` : idx}`, '');
    const fs2 = json.findings.filter((f) => f.url === pg.url);
    if (!fs2.length) { L.push(markdown ? 'No findings.' : '  no findings', ''); continue; }
    for (const [g] of [...GROUPS, ['Other']]) {
      const inG = fs2.filter((f) => groupOf(f.check) === g);
      if (!inG.length) continue;
      L.push(markdown ? `### ${g}` : `  ${g}`);
      if (markdown) L.push('');
      for (const f of inG) L.push(markdown ? `- **${f.severity}** \`${f.check}\` ${esc(f.detail)}` : `    ${f.severity.padEnd(5)} ${f.check}: ${f.detail}`);
      L.push('');
    }
  }
  const checks = Object.entries(s.byCheck).sort((a, b) => SEV_ORDER[a[0].split(' ')[0]] - SEV_ORDER[b[0].split(' ')[0]] || b[1] - a[1]);
  if (checks.length) {
    L.push(markdown ? '## Summary by check' : 'Summary by check', '');
    if (markdown) L.push('| Severity | Check | Count |', '| --- | --- | --- |');
    for (const [k, n] of checks) { const [sev, c] = k.split(' '); L.push(markdown ? `| ${sev} | ${c} | ${n} |` : `  ${sev.padEnd(5)} ${c.padEnd(24)} ${n}`); }
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

await main();
