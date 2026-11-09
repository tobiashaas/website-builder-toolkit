#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// Test runner for inventory.mjs: serves two fixture sites on random local ports (one with
// robots.txt, sitemap index and deliberate problems, one without sitemap) and checks the
// inventory, findings, output files and exit codes.
// Usage: node scripts/test/run.mjs

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'inventory.mjs');
const fixtures = path.join(here, 'fixtures');

function run(args, cwd = here) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { cwd });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => {
      let json = null;
      if (args.includes('json') && stdout) { try { json = JSON.parse(stdout); } catch {} }
      resolve({ status, stdout, stderr, json });
    });
  });
}

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------- fixture servers ----------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain' };
const requests = [];
function serve(root) {
  const routesFile = path.join(root, '_routes.json');
  const routes = fs.existsSync(routesFile) ? JSON.parse(fs.readFileSync(routesFile, 'utf8')) : {};
  const server = http.createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    requests.push({ root: path.basename(root), method: req.method, path: pathname, url: req.url, ua: req.headers['user-agent'] });
    const route = routes[pathname];
    if (route) { res.writeHead(route.status, { location: route.location }); res.end(); return; }
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || path.basename(file).startsWith('_')) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>'); return; }
    const body = fs.readFileSync(file, 'utf8').replaceAll('{{origin}}', origin);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
const serverA = await serve(path.join(fixtures, 'site-a'));
const serverB = await serve(path.join(fixtures, 'site-b'));
const A = `http://127.0.0.1:${serverA.address().port}`;
const B = `http://127.0.0.1:${serverB.address().port}`;
const fast = ['--delay', '0', '--no-out'];

// ---------------- usage errors ----------------
const noUrl = await run([]);
test('no URL: exit 1 with usage', () => assert(noUrl.status === 1 && /no URL/.test(noUrl.stderr), `status ${noUrl.status}, ${noUrl.stderr}`));
const badFormat = await run([`${A}/`, '--format', 'xml']);
test('bad --format: exit 1', () => assert(badFormat.status === 1 && /--format/.test(badFormat.stderr), `status ${badFormat.status}`));
const badMax = await run([`${A}/`, '--max', '0']);
test('bad --max: exit 1', () => assert(badMax.status === 1, `status ${badMax.status}`));
const ftp = await run(['ftp://example.org/']);
test('non-http URL: exit 1', () => assert(ftp.status === 1, `status ${ftp.status}`));

// Start URL that cannot be fetched: closed port
const closed = http.createServer();
await new Promise((r) => closed.listen(0, '127.0.0.1', r));
const deadPort = closed.address().port;
await new Promise((r) => closed.close(r));
const dead = await run([`http://127.0.0.1:${deadPort}/`, ...fast]);
test('unreachable start URL: exit 1', () => assert(dead.status === 1 && /could not be fetched/.test(dead.stderr), `status ${dead.status}, ${dead.stderr}`));
const start404 = await run([`${A}/gone/`, ...fast]);
test('start URL 404: exit 1', () => assert(start404.status === 1, `status ${start404.status}`));

// ---------------- site A: sitemap index, robots, problems ----------------
requests.length = 0;
const a = await run([`${A}/`, '--format', 'json', ...fast]);
const reqA = requests.slice();
const page = (p) => a.json?.pages.find((r) => r.url === `${A}${p}`);
const findings = (check) => a.json?.findings.filter((f) => f.check === check) ?? [];
const hasUrl = (check, p, sev) => {
  const hit = findings(check).filter((f) => (!sev || f.severity === sev) && f.urls.some((u) => u === `${A}${p}` || u.startsWith(`${A}${p} `)));
  assert(hit.length, `${check}${sev ? `/${sev}` : ''} not reported for ${p}: ${JSON.stringify(findings(check))}`);
};

test('site A: exit 0, JSON parsed', () => assert(a.status === 0 && a.json, `status ${a.status}, stderr ${a.stderr}`));
test('site A: sitemap index followed', () => {
  assert(a.json.sitemaps.some((s) => s.type === 'index') && a.json.sitemaps.some((s) => s.type === 'urlset' && s.urls === 11), JSON.stringify(a.json.sitemaps));
  assert(a.json.summary.sitemapUrls === 11, `sitemapUrls ${a.json.summary.sitemapUrls}`);
});
test('site A: lastmod from sitemap', () => assert(page('/about/')?.sitemapLastmod === '2026-10-01', JSON.stringify(page('/about/'))));
test('site A: robots.txt rule applied, /private/ never requested', () => {
  assert(!reqA.some((r) => r.path.startsWith('/private/')), 'private requested');
  assert(a.json.blocked.includes(`${A}/private/area/`), JSON.stringify(a.json.blocked));
  hasUrl('sitemap-blocked', '/private/area/', 'warn');
});
test('site A: other bot group ignored', () => assert(page('/about/'), 'about missing: Disallow: / of another bot applied'));
test('site A: only GET with the tool user agent', () => assert(reqA.every((r) => r.method === 'GET' && /^website-builder-toolkit-inventory\/0\.1 /.test(r.ua)), JSON.stringify(reqA.slice(0, 3))));
test('site A: unsafe query link not fetched', () => assert(!reqA.some((r) => /add-to-cart/.test(r.url)) && a.json.skippedUnsafe.some((u) => /add-to-cart/.test(u)), JSON.stringify(a.json.skippedUnsafe)));
test('site A: /about and /about/#team normalised to /about/', () => {
  assert(!a.json.pages.some((r) => r.url === `${A}/about`), '/about without slash kept');
  assert(a.json.slashConvention === 'slash', a.json.slashConvention);
});
test('site A: query variant with canonical folded into canonical', () => {
  const q = page('/about/?ref=home');
  assert(q && q.canonicalisedTo === `${A}/about/`, JSON.stringify(q));
  assert(!findings('duplicate-title').some((f) => f.urls.includes(`${A}/about/?ref=home`)), 'query variant in duplicate titles');
});
test('site A: duplicate title', () => {
  const f = findings('duplicate-title');
  assert(f.length === 1 && f[0].urls.includes(`${A}/about/`) && f[0].urls.includes(`${A}/services/web/`) && f[0].urls.length === 2, JSON.stringify(f));
});
test('site A: missing H1', () => hasUrl('missing-h1', '/contact/', 'warn'));
test('site A: multiple H1', () => hasUrl('multiple-h1', '/services/', 'warn'));
test('site A: redirect chain of 2 recorded', () => {
  const r = page('/old-page/');
  assert(r && r.redirectHops === 2 && r.status === 200 && r.finalUrl === `${A}/about/`, JSON.stringify(r));
  assert(r.redirectChain[0].status === 301 && r.redirectChain[1].status === 302, JSON.stringify(r.redirectChain));
  hasUrl('redirect-chain', '/old-page/', 'warn');
});
test('site A: 404 in sitemap is an error', () => {
  assert(page('/gone/')?.status === 404, JSON.stringify(page('/gone/')));
  hasUrl('status', '/gone/', 'error');
});
test('site A: orphan page', () => {
  hasUrl('orphan', '/orphan/', 'warn');
  const urls = findings('orphan').flatMap((f) => f.urls);
  assert(urls.length === 1, `unexpected orphans: ${JSON.stringify(urls)}`);
});
test('site A: noindex in sitemap is an error', () => { assert(page('/noindex/')?.noindex === true, 'noindex not parsed'); hasUrl('noindex-in-sitemap', '/noindex/', 'error'); });
test('site A: deep page at 4 clicks', () => {
  assert(page('/level1/level2/level3/level4/')?.clickDepth === 4, JSON.stringify(page('/level1/level2/level3/level4/')?.clickDepth));
  hasUrl('click-depth', '/level1/level2/level3/level4/', 'warn');
  assert(!findings('click-depth').some((f) => f.urls.some((u) => u.startsWith(`${A}/level1/level2/level3/ `))), 'level3 flagged');
});
test('site A: level pages found by links, not in sitemap', () => {
  assert(page('/level1/')?.source === 'link' && page('/level1/').inSitemap === false, JSON.stringify(page('/level1/')));
  hasUrl('not-in-sitemap', '/level1/', 'info');
});
test('site A: canonical pointing elsewhere', () => hasUrl('canonical-elsewhere', '/contact/', 'warn'));
test('site A: home page fields', () => {
  const h = page('/');
  assert(h.title === 'Fixture home page' && h.lang === 'en' && h.h1Count === 1 && h.h1First === 'Fixture home', JSON.stringify(h));
  assert(h.h2.join(',') === 'First,Second', JSON.stringify(h.h2));
  assert(h.canonicalSelf === true, `canonicalSelf ${h.canonicalSelf}`);
  assert(h.hreflang.length === 2 && h.hreflang.some((x) => x.lang === 'de' && x.href === `${A}/de/`), JSON.stringify(h.hreflang));
  assert(h.jsonLdTypes.includes('Organization') && h.jsonLdTypes.includes('WebSite'), JSON.stringify(h.jsonLdTypes));
  assert(h.images === 2 && h.imagesWithoutAlt === 1, `${h.images}/${h.imagesWithoutAlt}`);
  assert(h.externalLinks === 1, `external ${h.externalLinks}`);
  assert(h.wordCount >= 150 && h.wordCount < 220, `wordCount ${h.wordCount} (nav, header, footer must be excluded)`);
  assert(h.outlinks.includes(`${A}/services/`) && !h.outlinks.some((u) => u.includes('#')), JSON.stringify(h.outlinks));
});
test('site A: thin page as info', () => hasUrl('thin', '/de/', 'info'));
test('site A: title length as info', () => hasUrl('title-length', '/de/', 'info'));
test('site A: URL patterns (uppercase, underscore, parameters, depth)', () => {
  hasUrl('url-uppercase', '/Upper_Case/', 'info');
  hasUrl('url-underscore', '/Upper_Case/', 'info');
  hasUrl('url-parameters', '/about/?ref=home', 'info');
  hasUrl('url-depth', '/level1/level2/level3/level4/', 'info');
});
test('site A: inbound link counts', () => assert(page('/services/web/')?.inboundInternal === 1 && page('/orphan/')?.inboundInternal === 0, `${page('/services/web/')?.inboundInternal}`));
test('site A: link graph exported', () => assert(a.json.links.some(([f, t]) => f === `${A}/services/` && t === `${A}/services/web/`), 'edge missing'));
test('site A: summary counts match findings', () => {
  for (const s of ['error', 'warn', 'info']) assert(a.json.summary[s] === a.json.findings.filter((f) => f.severity === s).length, `${s} mismatch`);
});

// --max caps the fetches
const capped = await run([`${A}/`, '--format', 'json', '--max', '3', ...fast]);
test('site A --max 3: three URLs, rest listed as not fetched', () => {
  assert(capped.status === 0 && capped.json.pages.length <= 4 && capped.json.summary.notFetched > 0, `pages ${capped.json?.pages.length}, notFetched ${capped.json?.summary.notFetched}`);
  assert(capped.json.findings.some((f) => f.check === 'max-reached'), 'max-reached missing');
});

// Explicit --sitemap
const explicit = await run([`${A}/`, '--format', 'json', '--sitemap', `${A}/sitemap-pages.xml`, ...fast]);
test('site A --sitemap: explicit sitemap used', () => assert(explicit.json?.sitemaps.length === 1 && explicit.json.sitemaps[0].url === `${A}/sitemap-pages.xml` && explicit.json.summary.sitemapUrls === 11, JSON.stringify(explicit.json?.sitemaps)));

// ---------------- site B: no sitemap, crawl fallback ----------------
const b = await run([`${B}/`, '--format', 'json', ...fast]);
const pb = (p) => b.json?.pages.find((r) => r.url === `${B}${p}`);
test('site B: exit 0, crawled by links', () => {
  assert(b.status === 0 && b.json, `status ${b.status}, ${b.stderr}`);
  assert(b.json.summary.sitemapUrls === 0 && b.json.findings.some((f) => f.check === 'no-sitemap'), 'no-sitemap missing');
  assert(['/', '/a', '/b', '/c'].every((p) => pb(p)?.status === 200), JSON.stringify(b.json.pages.map((r) => r.url)));
  assert(b.json.pages.length === 4, `pages ${b.json.pages.length}`);
});
test('site B: no-slash convention kept', () => assert(b.json.slashConvention === 'noslash', b.json.slashConvention));
test('site B: click depth from links', () => assert(pb('/')?.clickDepth === 0 && pb('/a')?.clickDepth === 1 && pb('/c')?.clickDepth === 2, JSON.stringify(b.json.pages.map((r) => [r.url, r.clickDepth]))));
test('site B: no orphan findings without a sitemap', () => assert(!b.json.findings.some((f) => f.check === 'orphan'), 'orphan reported'));
test('site B: robots.txt missing is fine', () => assert(b.json.robots.found === false && b.json.robots.status === 404, JSON.stringify(b.json.robots)));

// ---------------- output files ----------------
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-test-'));
fs.mkdirSync(path.join(proj, 'website-builder'));
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inProj = await run([`${A}/`, '--delay', '0'], proj);
const outDir = path.join(proj, 'website-builder', 'structure', `inventory-${today}`);
test('data folder: default output folder written', () => {
  assert(inProj.status === 0, `status ${inProj.status}, ${inProj.stderr}`);
  for (const f of ['inventory.csv', 'inventory.json', 'report.md']) assert(fs.existsSync(path.join(outDir, f)), `${f} missing in ${outDir}`);
});
test('data folder: CSV has BOM, stable header, one row per URL', () => {
  const csv = fs.readFileSync(path.join(outDir, 'inventory.csv'), 'utf8');
  assert(csv.charCodeAt(0) === 0xfeff, 'no BOM');
  const lines = csv.slice(1).trim().split('\r\n');
  assert(lines[0].startsWith('url,source,in_sitemap,sitemap_lastmod,status,final_url,redirect_hops'), lines[0]);
  const j = JSON.parse(fs.readFileSync(path.join(outDir, 'inventory.json'), 'utf8'));
  assert(lines.length - 1 === j.pages.length, `${lines.length - 1} rows vs ${j.pages.length} pages`);
});
test('data folder: report.md sections', () => {
  const md = fs.readFileSync(path.join(outDir, 'report.md'), 'utf8');
  for (const h of ['## Summary', '### Errors', '### Warnings', '### Info', '## URL tree', '## Click depth']) assert(md.includes(h), `${h} missing`);
  assert(/\| 4 \| 1 \|/.test(md), 'depth 4 row missing in histogram');
  assert(md === inProj.stdout, 'stdout (md) differs from report.md');
});
const noOut = path.join(proj, 'sub');
fs.mkdirSync(noOut);
const csvRun = await run([`${B}/`, '--format', 'csv', '--no-out', '--delay', '0'], noOut);
test('--no-out inside a project writes nothing; --format csv prints CSV', () => {
  assert(!fs.existsSync(path.join(proj, 'website-builder', 'structure', `inventory-${today}`, 'x')), 'unexpected');
  assert(fs.readdirSync(path.join(proj, 'website-builder', 'structure')).length === 1, 'second folder written');
  assert(csvRun.stdout.startsWith('url,source,'), csvRun.stdout.slice(0, 40));
});
const explicitOut = path.join(proj, 'custom');
await run([`${B}/`, '--out', explicitOut, '--delay', '0']);
test('--out writes to the given folder', () => assert(fs.existsSync(path.join(explicitOut, 'report.md')), 'report.md missing'));
fs.rmSync(proj, { recursive: true, force: true });

serverA.close();
serverB.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
