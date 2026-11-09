#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// inventory: builds a page inventory of a live site from robots.txt, the XML sitemap and its
// internal links. Records status, redirects, title, description, canonical, robots, headings,
// word count, links, hreflang, JSON-LD types and images per URL, and reports structural
// findings (duplicates, missing H1, redirect chains, orphans, click depth). Reports only, never fixes.
// Node 18+, zero dependencies, GET only. Usage: scripts/README.md
//
//   node scripts/inventory.mjs <site-url> [--sitemap <url>] [--max 500] [--concurrency 4]
//        [--delay 250] [--same-host] [--format md|csv|json] [--out <dir>|--no-out]
//        [--user-agent "<ua>"]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

const VERSION = '0.1.0';
const UA_TOKEN = 'website-builder-toolkit-inventory';
const DEFAULT_UA = `${UA_TOKEN}/0.1 (+https://github.com/tobiashaas/website-builder-toolkit)`;
const TIMEOUT = 15000;
const MAX_HOPS = 10;
const MAX_BODY = 5 * 1024 * 1024;
const MAX_SITEMAPS = 50;
const URLS_PER_FINDING = 25;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage(msg) {
  if (msg) process.stderr.write(`inventory: ${msg}\n`);
  process.stderr.write(`usage: node inventory.mjs <site-url> [--sitemap <url>] [--max 500] [--concurrency 4]
       [--delay 250] [--same-host] [--format md|csv|json] [--out <dir>|--no-out]
       [--user-agent "<ua>"]
`);
  process.exit(1);
}

function parseArgs(argv) {
  const a = { url: null, sitemap: null, max: 500, concurrency: 4, delay: 250, sameHost: false, format: 'md', out: undefined, ua: DEFAULT_UA };
  const int = (t, v, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) usage(`${t} takes an integer between ${min} and ${max}`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) usage(`${t} needs a value`); return v; };
    if (t === '--sitemap') a.sitemap = val();
    else if (t === '--max') a.max = int(t, val(), 1, 100000);
    else if (t === '--concurrency') a.concurrency = int(t, val(), 1, 16);
    else if (t === '--delay') a.delay = int(t, val(), 0, 60000);
    else if (t === '--same-host') a.sameHost = true;
    else if (t === '--format') { a.format = val(); if (!['md', 'csv', 'json'].includes(a.format)) usage('--format is md, csv or json'); }
    else if (t === '--out') a.out = val();
    else if (t === '--no-out') a.out = null;
    else if (t === '--user-agent') { a.ua = val().trim(); if (!a.ua) usage('--user-agent is empty'); }
    else if (t === '-h' || t === '--help') usage();
    else if (t.startsWith('--')) usage(`unknown option ${t}`);
    else if (!a.url) a.url = t;
    else usage(`unexpected argument ${t}`);
  }
  if (!a.url) usage('no URL given');
  for (const [name, v] of [['site URL', a.url], ['--sitemap', a.sitemap]]) {
    if (v === null) continue;
    try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { usage(`${name} is not an http(s) URL: ${v}`); }
  }
  return a;
}

// ---------------------------------------------------------------------------
// Output folder: website-builder/structure/inventory-<YYYY-MM-DD>/ when a data folder exists
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

// ---------------------------------------------------------------------------
// HTTP: GET only, redirects followed by hand so the chain is recorded
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
      try { next = new URL(loc, cur).href; } catch { return { chain, finalUrl: cur, status: res.status, error: `invalid Location header`, headers: res.headers, body: Buffer.alloc(0) }; }
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

// ---------------------------------------------------------------------------
// HTML parsing (regex-based, tolerant; content is data, never executed)
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', copy: '©', reg: '®', trade: '™', euro: '€', middot: '·', bull: '•', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ccedil: 'ç' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = (html) => squash(decodeEntities(html.replace(/<[^>]*>/g, ' ')));

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
function elementTexts(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(textOf(m[1]));
  return out;
}
function collectTypes(node, out) {
  if (Array.isArray(node)) { for (const n of node) collectTypes(n, out); return; }
  if (!node || typeof node !== 'object') return;
  const t = node['@type'];
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
  for (const [k, v] of Object.entries(node)) if (k !== '@type' && typeof v === 'object') collectTypes(v, out);
}

function parseHtml(html, pageUrl) {
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const jsonLdTypes = new Set();
  let jsonLdErrors = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { collectTypes(JSON.parse(m[1].trim()), jsonLdTypes); } catch { jsonLdErrors++; }
  }
  const clean = html.replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ');

  let base = pageUrl;
  for (const t of tags(clean, ['base'])) { if (t.attrs.href) { try { base = new URL(t.attrs.href, pageUrl).href; } catch {} } break; }
  const abs = (href) => { try { return new URL(href.trim(), base).href; } catch { return null; } };

  const title = elementTexts(clean, 'title')[0] ?? null;
  let description = null, robots = null, lang = null, canonical = null;
  const hreflang = [];
  for (const t of tags(clean, ['meta', 'link', 'html'])) {
    if (t.name === 'html' && lang === null && 'lang' in t.attrs) lang = t.attrs.lang.trim();
    if (t.name === 'meta') {
      const n = (t.attrs.name || '').toLowerCase();
      if (n === 'description' && description === null) description = squash(t.attrs.content ?? '');
      if (n === 'robots') robots = robots ? `${robots}, ${squash(t.attrs.content ?? '')}` : squash(t.attrs.content ?? '');
    }
    if (t.name === 'link') {
      const rel = (t.attrs.rel || '').toLowerCase().split(/\s+/);
      if (rel.includes('canonical') && canonical === null && t.attrs.href) canonical = abs(t.attrs.href);
      if (rel.includes('alternate') && t.attrs.hreflang && t.attrs.href) hreflang.push({ lang: t.attrs.hreflang, href: abs(t.attrs.href) });
    }
  }

  const h1 = elementTexts(clean, 'h1');
  const h2 = elementTexts(clean, 'h2').filter(Boolean);

  const links = [];
  for (const t of tags(clean, ['a', 'area'])) {
    const href = t.attrs.href;
    if (href === undefined) continue;
    const h = href.trim();
    if (!h || h.startsWith('#') || /^(mailto|tel|javascript|data|sms|whatsapp|callto|fax):/i.test(h)) continue;
    const u = abs(h);
    if (u && /^https?:/.test(u)) links.push(u);
  }

  let images = 0, imagesWithoutAlt = 0;
  for (const t of tags(clean, ['img'])) { images++; if (!('alt' in t.attrs)) imagesWithoutAlt++; }

  const body = clean
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ')
    .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = textOf(body);
  const wordCount = text ? text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

  return {
    title, description, canonical, robots, lang,
    h1Count: h1.length, h1First: h1[0] ?? null, h2: h2.slice(0, 10),
    wordCount, links, hreflang, jsonLdTypes: [...jsonLdTypes], jsonLdErrors, images, imagesWithoutAlt,
  };
}

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309 subset: groups, Allow/Disallow, * and $, longest match)
// ---------------------------------------------------------------------------
function parseRobots(txt) {
  const groups = [];
  const sitemaps = [];
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
    if (key === 'sitemap') { if (v) sitemaps.push(v); continue; }
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (v) cur.rules.push({ allow: key === 'allow', path: v }); }
    else if (key === 'crawl-delay') { const n = Number(v); if (Number.isFinite(n) && n >= 0) cur.crawlDelay = n; }
  }
  return { groups, sitemaps };
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
    rules: rules.map(({ allow, path: p }) => ({ allow, path: p })),
    crawlDelay: delays.length ? Math.max(...delays) : null,
    allowed(url) {
      const u = new URL(url);
      let p = u.pathname + u.search;
      try { p = decodeURI(p); } catch {}
      let best = null;
      for (const r of rules) {
        if (!r.re.test(p) && !r.re.test(u.pathname + u.search)) continue;
        if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r;
      }
      return !best || best.allow;
    },
  };
}

// ---------------------------------------------------------------------------
// Sitemaps (index files followed, .gz unpacked)
// ---------------------------------------------------------------------------
function parseSitemap(xml) {
  const locOf = (block) => { const m = /<(?:\w+:)?loc>\s*([\s\S]*?)\s*<\/(?:\w+:)?loc>/i.exec(block); return m ? decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()) : null; };
  const lastmodOf = (block) => { const m = /<(?:\w+:)?lastmod>\s*([\s\S]*?)\s*<\/(?:\w+:)?lastmod>/i.exec(block); return m ? m[1].trim() : null; };
  if (/<(?:\w+:)?sitemapindex\b/i.test(xml)) {
    const children = [...xml.matchAll(/<(?:\w+:)?sitemap>([\s\S]*?)<\/(?:\w+:)?sitemap>/gi)].map((m) => locOf(m[1])).filter(Boolean);
    return { type: 'index', children, urls: [] };
  }
  if (/<(?:\w+:)?urlset\b/i.test(xml)) {
    const urls = [...xml.matchAll(/<(?:\w+:)?url>([\s\S]*?)<\/(?:\w+:)?url>/gi)].map((m) => ({ loc: locOf(m[1]), lastmod: lastmodOf(m[1]) })).filter((u) => u.loc);
    return { type: 'urlset', children: [], urls };
  }
  return null;
}

async function loadSitemaps(starts, ua, log) {
  const visited = new Set();
  const entries = new Map();
  const queue = starts.map((u) => ({ url: u, depth: 0 }));
  while (queue.length && visited.size < MAX_SITEMAPS) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const r = await fetchChain(url, ua, 'application/xml,text/xml;q=0.9,*/*;q=0.5');
    const rec = { url, status: r.status, finalUrl: r.finalUrl, type: null, urls: 0, error: r.error };
    log.push(rec);
    if (r.status !== 200) continue;
    let buf = r.body;
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = zlib.gunzipSync(buf); } catch { rec.error = 'gzip could not be unpacked'; continue; } }
    const parsed = parseSitemap(buf.toString('utf8'));
    if (!parsed) { rec.error = 'not a sitemap (no <urlset> or <sitemapindex>)'; continue; }
    rec.type = parsed.type;
    if (parsed.type === 'index') {
      rec.urls = parsed.children.length;
      if (depth < 3) for (const c of parsed.children) queue.push({ url: c, depth: depth + 1 });
    } else {
      rec.urls = parsed.urls.length;
      for (const u of parsed.urls) if (!entries.has(u.loc)) entries.set(u.loc, u.lastmod);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// URL normalisation and scope
// ---------------------------------------------------------------------------
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid)$/i;
const UNSAFE_QUERY = /^(add-to-cart|add_to_wishlist|remove_item|action|logout|replytocom|_wpnonce|nonce|wc-ajax|wc-api)$/i;
const ASSET = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|gz|tgz|rar|7z|mp4|m4v|webm|mov|avi|mp3|wav|ogg|m4a|css|js|mjs|json|xml|rss|atom|txt|csv|docx?|xlsx?|pptx?|odt|ods|woff2?|ttf|eot|otf|exe|dmg|apk)$/i;
const hasExtension = (p) => /\.[a-z0-9]{1,5}$/i.test(p.split('/').pop() || '');

function normalise(raw, base, slash) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (![...u.searchParams.keys()].length) u.search = '';
  if (slash && u.pathname !== '/' && !hasExtension(u.pathname)) {
    if (slash === 'slash' && !u.pathname.endsWith('/')) u.pathname += '/';
    else if (slash === 'noslash' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  }
  return u.href;
}
function slashConvention(urls) {
  let s = 0, n = 0;
  for (const raw of urls) {
    let p;
    try { p = new URL(raw).pathname; } catch { continue; }
    if (p === '/' || hasExtension(p)) continue;
    if (p.endsWith('/')) s++; else n++;
  }
  if (s > n) return 'slash';
  if (n > s) return 'noslash';
  return null;
}
function unsafeLink(url) {
  const u = new URL(url);
  if (/wp-login\.php|\/logout\b|\/wp-admin\//i.test(u.pathname)) return true;
  return [...u.searchParams.keys()].some((k) => UNSAFE_QUERY.test(k));
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------
async function crawl(args) {
  const startRes = await fetchChain(args.url, args.ua);
  if (startRes.error || startRes.status >= 400 || startRes.status === 0) {
    process.stderr.write(`inventory: start URL could not be fetched: ${args.url} (${startRes.error || `HTTP ${startRes.status}`})\n`);
    process.exit(1);
  }
  const site = new URL(startRes.finalUrl);
  const bareHost = (h) => h.replace(/^www\./, '');
  const inScope = (url) => {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    return args.sameHost ? u.hostname === site.hostname : bareHost(u.hostname) === bareHost(site.hostname);
  };

  // robots.txt
  const robotsUrl = `${site.origin}/robots.txt`;
  const rr = await fetchChain(robotsUrl, args.ua, 'text/plain,*/*;q=0.5');
  const robotsInfo = { url: robotsUrl, status: rr.status, error: rr.error, found: rr.status === 200, sitemaps: [], rules: [], crawlDelay: null, note: null };
  let robots = robotsMatcher({ groups: [], sitemaps: [] }, args.ua);
  if (rr.status === 200) {
    const parsed = parseRobots(rr.body.toString('utf8'));
    robots = robotsMatcher(parsed, args.ua);
    robotsInfo.sitemaps = parsed.sitemaps;
    robotsInfo.rules = robots.rules;
    robotsInfo.crawlDelay = robots.crawlDelay;
  } else if (rr.status >= 500 || rr.status === 0) {
    robotsInfo.note = 'robots.txt unreachable; crawled without rules';
  }
  const delay = Math.min(Math.max(args.delay, (robots.crawlDelay ?? 0) * 1000), 10000);

  // Sitemaps
  const sitemapLog = [];
  let sitemapRaw = new Map();
  if (args.sitemap) sitemapRaw = await loadSitemaps([args.sitemap], args.ua, sitemapLog);
  else if (robotsInfo.sitemaps.length) sitemapRaw = await loadSitemaps(robotsInfo.sitemaps, args.ua, sitemapLog);
  if (!sitemapRaw.size && !args.sitemap) {
    for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
      const u = `${site.origin}${p}`;
      if (sitemapLog.some((s) => s.url === u)) continue;
      sitemapRaw = await loadSitemaps([u], args.ua, sitemapLog);
      if (sitemapRaw.size) break;
    }
  }
  const sitemapOutOfScope = [...sitemapRaw.keys()].filter((u) => !inScope(u));

  // Trailing-slash convention from sitemap and the start page's own links
  const startHtml = /html/i.test(startRes.headers.get('content-type') || '') ? parseHtml(decodeBody(startRes.body, startRes.headers.get('content-type')), startRes.finalUrl) : null;
  const slash = slashConvention([...sitemapRaw.keys(), ...(startHtml?.links ?? [])].filter(inScope));
  const norm = (u, base) => normalise(u, base, slash);

  const sitemap = new Map();
  for (const [u, lastmod] of sitemapRaw) { if (!inScope(u)) continue; const k = norm(u); if (k && !sitemap.has(k)) sitemap.set(k, lastmod); }

  // State
  const rows = new Map(); // key -> row
  const seen = new Map(); // key -> source
  const queue = [];
  const blocked = new Map(); // key -> source
  const skippedUnsafe = new Set();
  const redirectMap = new Map();
  const aliasMap = new Map();
  let fetchCount = 0;

  const enqueue = (key, source) => {
    if (!key || seen.has(key)) return;
    if (!robots.allowed(key)) { if (!blocked.has(key)) blocked.set(key, source); return; }
    if (unsafeLink(key)) { skippedUnsafe.add(key); return; }
    seen.set(key, source);
    queue.push(key);
  };

  const newRow = (key, source) => ({
    url: key, source, inSitemap: sitemap.has(key), sitemapLastmod: sitemap.get(key) ?? null,
    status: null, finalUrl: null, redirectChain: [], redirectHops: 0, error: null, contentType: null, xRobotsTag: null,
    title: null, description: null, canonical: null, canonicalSelf: null, robots: null, noindex: false, lang: null,
    h1Count: null, h1First: null, h2: [], wordCount: null,
    internalLinks: 0, externalLinks: 0, outlinks: [], inboundInternal: 0, clickDepth: null,
    hreflang: [], jsonLdTypes: [], jsonLdErrors: 0, images: null, imagesWithoutAlt: null, canonicalisedTo: null,
  });

  const fill = (row, res) => {
    row.status = res.status;
    row.finalUrl = res.finalUrl;
    row.redirectChain = res.chain;
    row.redirectHops = res.chain.length;
    row.error = res.error;
    row.contentType = res.headers.get('content-type');
    row.xRobotsTag = res.headers.get('x-robots-tag');
    if (row.xRobotsTag && /noindex|none/i.test(row.xRobotsTag)) row.noindex = true;
    if (res.chain.length) {
      const fk = inScope(res.finalUrl) ? norm(res.finalUrl) : null;
      if (fk && fk !== row.url) {
        redirectMap.set(row.url, fk);
        if (!seen.has(fk) && robots.allowed(fk)) {
          seen.set(fk, 'redirect');
          const r2 = newRow(fk, 'redirect');
          rows.set(fk, r2);
          fill(r2, { ...res, chain: [] });
        }
      }
      return;
    }
    if (res.status !== 200 || !/html/i.test(row.contentType || '')) return;
    const p = parseHtml(decodeBody(res.body, row.contentType), res.finalUrl);
    Object.assign(row, {
      title: p.title, description: p.description, canonical: p.canonical, robots: p.robots, lang: p.lang,
      h1Count: p.h1Count, h1First: p.h1First, h2: p.h2, wordCount: p.wordCount, hreflang: p.hreflang,
      jsonLdTypes: p.jsonLdTypes, jsonLdErrors: p.jsonLdErrors, images: p.images, imagesWithoutAlt: p.imagesWithoutAlt,
    });
    if (p.robots && /noindex|none/i.test(p.robots)) row.noindex = true;
    if (p.canonical) row.canonicalSelf = norm(p.canonical) === row.url;
    const out = new Set();
    for (const l of p.links) {
      if (inScope(l)) { row.internalLinks++; const k = norm(l); if (k) out.add(k); }
      else row.externalLinks++;
    }
    row.outlinks = [...out];
    // Query URLs that declare a canonical: keep the canonical, not the query variant
    if (new URL(row.url).search && p.canonical && !row.canonicalSelf && inScope(p.canonical)) {
      const ck = norm(p.canonical);
      row.canonicalisedTo = ck;
      aliasMap.set(row.url, ck);
      enqueue(ck, 'canonical');
    }
    for (const k of row.outlinks) if (!ASSET.test(new URL(k).pathname)) enqueue(k, 'link');
  };

  // Seeds: start page, then sitemap URLs, then links (breadth-first)
  const startKey = norm(args.url);
  seen.set(startKey, 'start');
  const startRow = newRow(startKey, 'start');
  rows.set(startKey, startRow);
  fetchCount++;
  for (const k of sitemap.keys()) enqueue(k, 'sitemap'); // sitemap first: it wins the --max budget
  fill(startRow, startRes);

  let active = 0, lastProgress = 0;
  const worker = async () => {
    for (;;) {
      if (queue.length && fetchCount < args.max) {
        const key = queue.shift();
        if (rows.has(key)) continue;
        fetchCount++;
        active++;
        const row = newRow(key, seen.get(key));
        rows.set(key, row);
        const res = await fetchChain(key, args.ua);
        fill(row, res);
        active--;
        if (process.stderr.isTTY && fetchCount - lastProgress >= 25) { lastProgress = fetchCount; process.stderr.write(`inventory: ${fetchCount} fetched, ${queue.length} queued\n`); }
        if (delay) await sleep(delay);
      } else if (active === 0) return;
      else await sleep(20);
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, worker));

  return {
    site, startKey, slash, robotsInfo, sitemapLog, sitemap, sitemapOutOfScope, rows, queue, blocked, skippedUnsafe, redirectMap, aliasMap, delay,
    notFetched: queue.filter((k) => !rows.has(k)),
  };
}

// ---------------------------------------------------------------------------
// Analysis: link graph, click depth, findings
// ---------------------------------------------------------------------------
function analyse(c) {
  const resolve = (k) => {
    for (let i = 0; i < 12; i++) {
      const n = c.redirectMap.get(k) ?? c.aliasMap.get(k);
      if (!n || n === k) break;
      k = n;
    }
    return k;
  };
  const rows = [...c.rows.values()];
  const inbound = new Map();
  const edges = [];
  for (const r of rows) {
    for (const t of r.outlinks) {
      edges.push([r.url, t]);
      const rt = resolve(t);
      if (rt === r.url) continue;
      if (!inbound.has(rt)) inbound.set(rt, new Set());
      inbound.get(rt).add(r.url);
    }
  }
  for (const r of rows) r.inboundInternal = inbound.get(r.url)?.size ?? 0;

  // Click depth: breadth-first over resolved internal links from the start page
  const start = resolve(c.startKey);
  const depth = new Map([[start, 0]]);
  if (c.startKey !== start) depth.set(c.startKey, 0);
  const q = [start];
  while (q.length) {
    const k = q.shift();
    const r = c.rows.get(k);
    if (!r) continue;
    for (const t of r.outlinks) {
      const rt = resolve(t);
      if (!depth.has(rt)) { depth.set(rt, depth.get(k) + 1); q.push(rt); }
      if (!depth.has(t)) depth.set(t, depth.get(k) + 1);
    }
  }
  for (const r of rows) r.clickDepth = depth.get(r.url) ?? null;

  const findings = [];
  const add = (severity, check, message, urls = []) => findings.push({ severity, check, message, urls });
  const isPage = (r) => r.status === 200 && !r.redirectHops && /html/i.test(r.contentType || '') && !r.canonicalisedTo;
  const pages = rows.filter(isPage);
  const indexable = pages.filter((r) => !r.noindex);

  // Status and redirects
  for (const r of rows) {
    if (!r.error && r.status === 200) continue;
    const what = r.error ? r.error : `HTTP ${r.status}`;
    add('error', 'status', `${what}${r.redirectHops ? ` after ${r.redirectHops} redirect(s) to ${r.finalUrl}` : ''}${r.inSitemap ? ' (listed in sitemap)' : ''}`, [r.url]);
  }
  const chains = rows.filter((r) => r.redirectHops > 1);
  if (chains.length) add('warn', 'redirect-chain', 'redirect chain with more than one hop', chains.map((r) => `${r.url} → ${[...r.redirectChain.slice(1).map((h) => h.url), r.finalUrl].join(' → ')} (${r.redirectHops} hops)`));
  const smRedirects = rows.filter((r) => r.inSitemap && r.redirectHops === 1);
  if (smRedirects.length) add('info', 'sitemap-redirect', 'sitemap lists a URL that redirects; list the target instead', smRedirects.map((r) => `${r.url} → ${r.finalUrl}`));
  const linkedRedirects = rows.filter((r) => r.redirectHops && r.inboundInternal && !r.inSitemap);
  if (linkedRedirects.length) add('info', 'linked-redirect', 'internal links point to a redirecting URL', linkedRedirects.map((r) => `${r.url} → ${r.finalUrl} (${r.inboundInternal} linking page(s))`));

  // Duplicates
  const dupes = (field, check, label) => {
    const groups = new Map();
    for (const r of indexable) {
      const v = (r[field] || '').trim().toLowerCase();
      if (!v) continue;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(r.url);
    }
    for (const urls of groups.values()) if (urls.length > 1) add('warn', check, `${urls.length} indexable pages share the same ${label}`, urls);
  };
  dupes('title', 'duplicate-title', 'title');
  dupes('description', 'duplicate-description', 'meta description');

  const list = (sev, check, msg, rs, fmt = (r) => r.url) => { if (rs.length) add(sev, check, msg, rs.map(fmt)); };
  list('warn', 'missing-title', 'no <title>', pages.filter((r) => !r.title));
  list('warn', 'missing-description', 'no meta description', indexable.filter((r) => !r.description));
  list('warn', 'missing-h1', 'no H1', pages.filter((r) => r.h1Count === 0));
  list('warn', 'multiple-h1', 'more than one H1', pages.filter((r) => r.h1Count > 1), (r) => `${r.url} (${r.h1Count})`);
  list('info', 'title-length', 'title longer than 60 or shorter than 15 characters', pages.filter((r) => r.title && (r.title.length > 60 || r.title.length < 15)), (r) => `${r.url} (${r.title.length})`);
  list('info', 'description-length', 'meta description longer than 160 or shorter than 50 characters', pages.filter((r) => r.description && (r.description.length > 160 || r.description.length < 50)), (r) => `${r.url} (${r.description.length})`);
  list('warn', 'canonical-elsewhere', 'canonical points to another URL', pages.filter((r) => r.canonical && r.canonicalSelf === false), (r) => `${r.url} → ${r.canonical}`);
  list('error', 'noindex-in-sitemap', 'sitemap lists a noindex page', rows.filter((r) => r.inSitemap && r.noindex && r.status === 200));
  list('info', 'noindex', 'noindex page not in the sitemap', rows.filter((r) => !r.inSitemap && r.noindex && r.status === 200));
  if (c.sitemap.size) {
    list('warn', 'orphan', 'in the sitemap, but no internal link from any crawled page', pages.filter((r) => r.inSitemap && r.inboundInternal === 0 && r.url !== resolve(c.startKey)));
    list('info', 'not-in-sitemap', 'indexable page reached by links but missing from the sitemap', indexable.filter((r) => !r.inSitemap && r.url !== resolve(c.startKey)));
  }
  list('warn', 'click-depth', 'more than 3 clicks from the start page', pages.filter((r) => r.clickDepth !== null && r.clickDepth > 3), (r) => `${r.url} (${r.clickDepth})`);
  list('info', 'unreachable', 'linked from crawled pages, but not reachable from the start page', pages.filter((r) => r.clickDepth === null && r.inboundInternal > 0));
  list('info', 'thin', 'fewer than 150 words of visible text (nav, header and footer excluded)', indexable.filter((r) => r.wordCount < 150), (r) => `${r.url} (${r.wordCount})`);
  list('info', 'missing-lang', 'no lang attribute on <html>', pages.filter((r) => !r.lang));
  list('info', 'image-alt', 'images without an alt attribute', pages.filter((r) => r.imagesWithoutAlt > 0), (r) => `${r.url} (${r.imagesWithoutAlt} of ${r.images})`);
  list('info', 'jsonld-invalid', 'JSON-LD block that does not parse', pages.filter((r) => r.jsonLdErrors > 0), (r) => `${r.url} (${r.jsonLdErrors})`);

  // URL patterns
  const pathOf = (u) => new URL(u).pathname;
  const segs = (u) => pathOf(u).split('/').filter(Boolean).length;
  const all = rows.map((r) => r.url);
  const pat = (msg, check, pred) => { const hit = all.filter(pred); if (hit.length) add('info', check, msg, hit); };
  pat('URL path deeper than 3 segments', 'url-depth', (u) => segs(u) > 3);
  pat('uppercase letters in the URL path', 'url-uppercase', (u) => /[A-Z]/.test(pathOf(u)));
  pat('underscores in the URL path', 'url-underscore', (u) => pathOf(u).includes('_'));
  pat('query parameters in the URL', 'url-parameters', (u) => !!new URL(u).search);
  pat('URL longer than 115 characters', 'url-length', (u) => u.length > 115);

  // Crawl scope notes
  if (c.blocked.size) add('info', 'robots-blocked', 'not fetched: disallowed by robots.txt', [...c.blocked.keys()]);
  const blockedInSitemap = [...c.blocked.keys()].filter((k) => c.sitemap.has(k));
  if (blockedInSitemap.length) add('warn', 'sitemap-blocked', 'sitemap lists a URL that robots.txt disallows', blockedInSitemap);
  if (c.sitemapOutOfScope.length) add('info', 'sitemap-foreign-host', 'sitemap lists URLs on another host (skipped)', c.sitemapOutOfScope);
  if (c.notFetched.length) add('info', 'max-reached', `--max reached: ${c.notFetched.length} queued URL(s) not fetched; orphan and depth results are incomplete`, c.notFetched);
  if (!c.sitemap.size) add('info', 'no-sitemap', 'no sitemap found; URLs discovered by following links from the start page');
  for (const s of c.sitemapLog.filter((s) => s.status !== 200 || s.error)) add('info', 'sitemap-fetch', `sitemap not usable: ${s.error || `HTTP ${s.status}`}`, [s.url]);

  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, edges, start, pages, indexable };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const COLUMNS = [
  ['url', (r) => r.url], ['source', (r) => r.source], ['in_sitemap', (r) => (r.inSitemap ? 'yes' : 'no')], ['sitemap_lastmod', (r) => r.sitemapLastmod],
  ['status', (r) => r.status], ['final_url', (r) => (r.finalUrl !== r.url ? r.finalUrl : '')], ['redirect_hops', (r) => r.redirectHops],
  ['redirect_chain', (r) => r.redirectChain.map((h) => `${h.status} ${h.url}`).join(' > ')], ['error', (r) => r.error], ['content_type', (r) => r.contentType],
  ['title', (r) => r.title], ['title_length', (r) => r.title?.length], ['meta_description', (r) => r.description], ['description_length', (r) => r.description?.length],
  ['canonical', (r) => r.canonical], ['canonical_self', (r) => (r.canonicalSelf === null ? '' : r.canonicalSelf ? 'yes' : 'no')],
  ['meta_robots', (r) => r.robots], ['x_robots_tag', (r) => r.xRobotsTag], ['noindex', (r) => (r.noindex ? 'yes' : 'no')], ['lang', (r) => r.lang],
  ['h1_count', (r) => r.h1Count], ['h1_first', (r) => r.h1First], ['h2', (r) => r.h2.join(' | ')], ['word_count', (r) => r.wordCount],
  ['internal_links', (r) => r.internalLinks], ['external_links', (r) => r.externalLinks], ['inbound_internal_links', (r) => r.inboundInternal], ['click_depth', (r) => r.clickDepth],
  ['hreflang', (r) => r.hreflang.map((h) => `${h.lang}=${h.href}`).join(' | ')], ['jsonld_types', (r) => r.jsonLdTypes.join(' | ')],
  ['images', (r) => r.images], ['images_without_alt', (r) => r.imagesWithoutAlt],
];
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+@\t\r]/.test(s) || /^-[^\s\d]/.test(s)) s = `'${s}`; // spreadsheet formula guard for fetched text
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  const lines = [COLUMNS.map((c) => c[0]).join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvCell(c[1](r))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function urlTree(rows) {
  const top = new Map();
  for (const r of rows) {
    const s = new URL(r.url).pathname.split('/').filter(Boolean);
    const a = s[0] ? `/${s[0]}/` : '/';
    if (!top.has(a)) top.set(a, { n: 0, sub: new Map() });
    const t = top.get(a);
    t.n++;
    if (s[1]) { const b = `${a}${s[1]}/`; t.sub.set(b, (t.sub.get(b) || 0) + 1); }
  }
  const lines = [];
  for (const [a, t] of [...top].sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0]))) {
    lines.push(`- \`${a}\` ${t.n}`);
    const subs = [...t.sub].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    for (const [b, n] of subs.slice(0, 15)) lines.push(`  - \`${b}\` ${n}`);
    if (subs.length > 15) lines.push(`  - ${subs.length - 15} more`);
  }
  return lines;
}

function mdEscape(s) { return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

function toMarkdown(c, a, meta) {
  const rows = [...c.rows.values()];
  const count = (p) => rows.filter(p).length;
  const sev = (s) => a.findings.filter((f) => f.severity === s);
  const L = [];
  L.push(`# Site inventory: ${c.site.hostname}`, '');
  L.push(`Start ${meta.startUrl}, generated ${meta.generatedAt} by inventory ${VERSION}. Findings report what was fetched; nothing on the site was changed.`, '');
  L.push('## Summary', '', '| Measure | Count |', '| --- | ---: |');
  const s = [
    ['URLs fetched', rows.length],
    ['Listed in sitemap (in scope)', c.sitemap.size],
    ['HTML pages with status 200', a.pages.length],
    ['Indexable pages', a.indexable.length],
    ['Redirecting URLs', count((r) => r.redirectHops > 0)],
    ['Client errors (4xx)', count((r) => r.status >= 400 && r.status < 500)],
    ['Server errors (5xx) and failed fetches', count((r) => r.status >= 500 || r.status === 0)],
    ['noindex pages', count((r) => r.noindex)],
    ['Disallowed by robots.txt (not fetched)', c.blocked.size],
    ['Queued but not fetched (--max)', c.notFetched.length],
    ['Internal link edges', a.edges.length],
    ['Findings: error / warn / info', `${sev('error').length} / ${sev('warn').length} / ${sev('info').length}`],
  ];
  for (const [k, v] of s) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## Findings', '');
  for (const [key, label] of [['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Info']]) {
    const fs_ = sev(key);
    L.push(`### ${label} (${fs_.length})`, '');
    if (!fs_.length) { L.push('None.', ''); continue; }
    for (const f of fs_) {
      L.push(`- **${f.check}**: ${mdEscape(f.message)}${f.urls.length > 1 ? ` (${f.urls.length})` : ''}`);
      for (const u of f.urls.slice(0, URLS_PER_FINDING)) L.push(`  - ${mdEscape(u)}`);
      if (f.urls.length > URLS_PER_FINDING) L.push(`  - ${f.urls.length - URLS_PER_FINDING} more in inventory.json`);
    }
    L.push('');
  }
  L.push('## URL tree', '', 'Fetched URLs by first and second path segment.', '');
  L.push(...urlTree(rows), '');
  L.push('## Click depth', '', 'Clicks from the start page over internal links, HTML pages with status 200.', '', '| Depth | Pages |', '| ---: | ---: |');
  const hist = new Map();
  for (const r of a.pages) { const d = r.clickDepth === null ? 'not reached' : r.clickDepth; hist.set(d, (hist.get(d) || 0) + 1); }
  for (const [d, n] of [...hist].sort((x, y) => (x[0] === 'not reached' ? 1e9 : x[0]) - (y[0] === 'not reached' ? 1e9 : y[0]))) L.push(`| ${d} | ${n} |`);
  L.push('');
  L.push('## Sources', '');
  L.push(`- robots.txt: ${c.robotsInfo.found ? `found, ${c.robotsInfo.rules.length} rule(s) apply, ${c.robotsInfo.sitemaps.length} Sitemap line(s)` : `not found (${c.robotsInfo.error || `HTTP ${c.robotsInfo.status}`})`}${c.robotsInfo.crawlDelay !== null ? `, crawl-delay ${c.robotsInfo.crawlDelay} s` : ''}`);
  for (const sm of c.sitemapLog) L.push(`- sitemap ${sm.url}: ${sm.status === 200 && !sm.error ? `${sm.type}, ${sm.urls} entries` : sm.error || `HTTP ${sm.status}`}`);
  L.push(`- trailing slash convention: ${c.slash ?? 'mixed or unknown, URLs kept as found'}`);
  L.push(`- scope: ${meta.sameHost ? `exactly ${c.site.hostname}` : `${c.site.hostname.replace(/^www\./, '')} with and without www`}; delay ${c.delay} ms, concurrency ${meta.concurrency}`);
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const c = await crawl(args);
const a = analyse(c);
const rows = [...c.rows.values()];
const meta = { startUrl: args.url, generatedAt, sameHost: args.sameHost, concurrency: args.concurrency };
const md = toMarkdown(c, a, meta);
const csv = toCsv(rows);
const json = {
  tool: 'inventory', version: VERSION, generatedAt, startUrl: args.url, start: a.start, site: c.site.origin,
  options: { max: args.max, concurrency: args.concurrency, delay: c.delay, sameHost: args.sameHost, userAgent: args.ua, sitemap: args.sitemap },
  slashConvention: c.slash,
  robots: c.robotsInfo,
  sitemaps: c.sitemapLog,
  summary: {
    fetched: rows.length, sitemapUrls: c.sitemap.size, htmlPages: a.pages.length, indexable: a.indexable.length,
    blockedByRobots: c.blocked.size, notFetched: c.notFetched.length,
    error: a.findings.filter((f) => f.severity === 'error').length,
    warn: a.findings.filter((f) => f.severity === 'warn').length,
    info: a.findings.filter((f) => f.severity === 'info').length,
  },
  findings: a.findings,
  pages: rows,
  links: a.edges,
  blocked: [...c.blocked.keys()],
  notFetched: c.notFetched,
  skippedUnsafe: [...c.skippedUnsafe],
};

let outDir = args.out;
if (outDir === undefined) {
  const data = findDataFolder(process.cwd());
  outDir = data ? path.join(data, 'structure', `inventory-${localDate()}`) : null;
}
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'inventory.csv'), `﻿${csv}`);
  fs.writeFileSync(path.join(outDir, 'inventory.json'), `${JSON.stringify({ ...json, outDir }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
}
if (args.format === 'json') process.stdout.write(`${JSON.stringify({ ...json, outDir }, null, 2)}\n`);
else if (args.format === 'csv') process.stdout.write(csv);
else process.stdout.write(md);
process.stderr.write(`inventory: ${rows.length} URL(s), ${json.summary.error} error(s), ${json.summary.warn} warning(s), ${json.summary.info} info${outDir ? `; wrote ${outDir}` : ''}\n`);
process.exit(0);
