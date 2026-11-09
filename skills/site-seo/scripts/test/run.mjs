#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// Test runner for seo-check.mjs: serves the fixture site on a random local port and checks
// findings, consistency checks against the brand fixture, output files and exit codes.
// Usage: node scripts/test/run.mjs

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'seo-check.mjs');
const fixtures = path.join(here, 'fixtures');
const brandFile = path.join(fixtures, 'brand.md');

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

// ---------------- fixture server ----------------
const root = path.join(fixtures, 'site');
const requests = [];
const server = http.createServer((req, res) => {
  const origin = `http://${req.headers.host}`;
  const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
  requests.push({ method: req.method, path: pathname, ua: req.headers['user-agent'] });
  if (pathname === '/moved/') { res.writeHead(301, { location: '/clean/' }); res.end(); return; }
  let file = path.join(root, pathname);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>'); return; }
  const body = fs.readFileSync(file, 'utf8').replaceAll('{{origin}}', origin);
  res.writeHead(200, { 'content-type': file.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const S = `http://127.0.0.1:${server.address().port}`;
const fast = ['--delay', '0', '--no-out'];
const PAGES = ['clean', 'bad-head', 'dup-a', 'dup-b', 'jsonld-syntax', 'local', 'faq', 'product', 'breadcrumb', 'en', 'de', 'anchors', 'footer-phone', 'event', 'private'].map((p) => `${S}/${p}/`);

// ---------------- usage errors ----------------
const noUrl = await run([]);
test('no URL: exit 1 with usage', () => assert(noUrl.status === 1 && /no URL/.test(noUrl.stderr), `status ${noUrl.status}, ${noUrl.stderr}`));
const badFormat = await run([`${S}/clean/`, '--format', 'xml']);
test('bad --format: exit 1', () => assert(badFormat.status === 1 && /--format/.test(badFormat.stderr), `status ${badFormat.status}`));
const ftp = await run(['ftp://example.org/']);
test('non-http URL: exit 1', () => assert(ftp.status === 1, `status ${ftp.status}`));
const badInv = await run(['--from-inventory', path.join(here, 'missing.json')]);
test('missing inventory file: exit 1', () => assert(badInv.status === 1 && /inventory/.test(badInv.stderr), `status ${badInv.status}`));

// ---------------- full run ----------------
requests.length = 0;
const r = await run([...PAGES, `${S}/moved/`, `${S}/gone/`, '--brand', brandFile, '--format', 'json', ...fast]);
const reqs = requests.slice();
const f = (p, check, sev) => r.json?.findings.filter((x) => x.url === `${S}${p}` && x.check === check && (!sev || x.severity === sev)) ?? [];
const has = (p, check, sev, re) => {
  const hit = f(p, check, sev).filter((x) => !re || re.test(x.detail));
  assert(hit.length, `${check}${sev ? `/${sev}` : ''}${re ? ` ${re}` : ''} not reported for ${p}: ${JSON.stringify(r.json?.findings.filter((x) => x.url === `${S}${p}`))}`);
};

test('run: exit 1 (error findings), JSON parsed', () => assert(r.status === 1 && r.json, `status ${r.status}, stderr ${r.stderr}`));
test('only GET with the seo user agent', () => assert(reqs.every((x) => x.method === 'GET' && /^website-builder-toolkit-seo\/0\.1 /.test(x.ua)), JSON.stringify(reqs.slice(0, 3))));
test('findings have url, check, severity, detail', () => assert(r.json.findings.every((x) => x.url && x.check && ['error', 'warn', 'info'].includes(x.severity) && typeof x.detail === 'string'), 'bad finding shape'));
test('clean page: no errors or warnings', () => {
  const bad = r.json.findings.filter((x) => x.url === `${S}/clean/` && x.severity !== 'info');
  assert(!bad.length, JSON.stringify(bad));
  const pg = r.json.pages.find((p) => p.url === `${S}/clean/`);
  assert(pg.canonicalSelf === true && pg.noindex === false && pg.status === 200, JSON.stringify(pg));
  assert(pg.jsonLdTypes.includes('LocalBusiness') && pg.jsonLdTypes.includes('WebSite'), JSON.stringify(pg.jsonLdTypes));
});
test('bad head: missing title, description, H1, lang, viewport, canonical', () => {
  has('/bad-head/', 'missing-title', 'error');
  has('/bad-head/', 'missing-description', 'warn');
  has('/bad-head/', 'missing-h1');
  has('/bad-head/', 'missing-lang');
  has('/bad-head/', 'missing-viewport');
  has('/bad-head/', 'missing-canonical');
});
test('duplicate title across pages, description not duplicate', () => {
  has('/dup-a/', 'duplicate-title', 'warn', /dup-b/);
  has('/dup-b/', 'duplicate-title', 'warn', /dup-a/);
  assert(!f('/dup-a/', 'duplicate-description').length, 'descriptions differ');
});
test('JSON-LD syntax error reported with block index', () => {
  has('/jsonld-syntax/', 'jsonld-syntax', 'error', /^block 2:/);
  assert(!f('/jsonld-syntax/', 'jsonld-syntax').some((x) => /^block 1/.test(x.detail)), 'block 1 is valid');
});
test('LocalBusiness subtype missing required name and address', () => {
  has('/local/', 'jsonld-required', 'error', /missing required name/);
  has('/local/', 'jsonld-required', 'error', /missing required address/);
});
test('FAQ: invisible question and answer flagged, visible one passes', () => {
  has('/faq/', 'jsonld-not-visible', 'error', /Ersatzwagen/);
  has('/faq/', 'jsonld-not-visible', 'error', /immer kostenlos/);
  assert(!f('/faq/', 'jsonld-not-visible').some((x) => /Inspektion|Stunden/.test(x.detail)), 'visible FAQ flagged');
  has('/faq/', 'jsonld-faq-eligibility', 'info');
});
test('Product: price not on page, name and rating visible', () => {
  has('/product/', 'jsonld-not-visible', 'error', /price .*"49\.99"/);
  assert(f('/product/', 'jsonld-not-visible').length === 1, JSON.stringify(f('/product/', 'jsonld-not-visible')));
  assert(!f('/product/', 'jsonld-required').length, 'Product is complete');
});
test('BreadcrumbList: valid, names visible, last item without item allowed', () => {
  const bad = r.json.findings.filter((x) => x.url === `${S}/breadcrumb/` && x.severity === 'error');
  assert(!bad.length, JSON.stringify(bad));
});
test('hreflang without return link', () => {
  has('/en/', 'hreflang-return', 'error', /de →/);
  assert(!f('/de/', 'hreflang-return').length, '/de/ has no hreflang at all');
});
test('anchors: generic, empty (aria-label counts), internal nofollow', () => {
  has('/anchors/', 'generic-anchor', 'warn', /3 link/);
  has('/anchors/', 'empty-anchor', 'error', /1 link/);
  has('/anchors/', 'internal-nofollow', 'warn', /\/en\//);
  // the fixture server is plain http, so http links are not mixed content here
  assert(!f('/anchors/', 'insecure-link').length, 'insecure-link on an http page');
});
test('anchors page: heading skip, empty heading, image alt, file name', () => {
  has('/anchors/', 'heading-skip', 'warn', /h2 → h4/);
  has('/anchors/', 'empty-heading', 'warn');
  has('/anchors/', 'image-alt', 'error', /1 image/);
  has('/anchors/', 'image-dimensions', 'info');
  has('/anchors/', 'image-filename', 'info', /2 image/);
});
test('brand: footer phone, street and JSON-LD name differ', () => {
  has('/footer-phone/', 'nap-mismatch', 'warn', /footer\/contact phone "07721 654321".*\+49 7721 123456/);
  has('/footer-phone/', 'nap-mismatch', 'warn', /footer\/contact street "Bahnhofstraße 3"/);
  has('/footer-phone/', 'nap-mismatch', 'warn', /name "Andere Firma AG"/);
  const nap = f('/footer-phone/', 'nap-mismatch');
  assert(!nap.some((x) => /telephone|streetAddress|postalCode|999999/.test(x.detail)), `matching values or fax flagged: ${JSON.stringify(nap)}`);
});
test('brand: values read from profile', () => {
  const b = r.json.brand;
  assert(b.name === 'Muster Werkstatt GmbH' && b.phones.length === 1 && b.streets[0] === 'Hauptstraße 12' && b.postalCodes[0] === '78050', JSON.stringify(b));
});
test('Event date and job title visible; JobPosting requirements', () => {
  assert(!f('/event/', 'jsonld-not-visible').length, JSON.stringify(f('/event/', 'jsonld-not-visible')));
  has('/event/', 'jsonld-required', 'error', /JobPosting is missing required datePosted/);
  has('/event/', 'jsonld-required', 'error', /jobLocation.*addressCountry/);
});
test('robots.txt disallow: reported, not fetched', () => {
  has('/private/', 'robots-txt', 'warn');
  assert(!reqs.some((x) => x.path === '/private/'), '/private/ requested');
});
test('redirect and 404 reported', () => {
  has('/moved/', 'redirect', 'info');
  has('/gone/', 'status', 'error', /404/);
});

// ---------------- formats ----------------
const text = await run([`${S}/clean/`, `${S}/bad-head/`, '--no-brand', ...fast]);
test('text format: grouped by page and check, summary', () => {
  assert(text.status === 1, `status ${text.status}`);
  assert(text.stdout.includes(`${S}/bad-head/`) && /\n  Head\n/.test(text.stdout) && /error missing-title/.test(text.stdout) && /Summary by check/.test(text.stdout), text.stdout);
});
const clean = await run([`${S}/clean/`, '--brand', brandFile, '--format', 'md', ...fast]);
test('clean page alone: exit 0, markdown', () => assert(clean.status === 0 && clean.stdout.startsWith('# SEO check'), `status ${clean.status}\n${clean.stdout}`));

// ---------------- data folder, brand auto-detect, inventory input ----------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-check-'));
fs.mkdirSync(path.join(tmp, 'website-builder'));
fs.copyFileSync(brandFile, path.join(tmp, 'website-builder', 'brand.md'));
const inv = path.join(tmp, 'inventory.json');
fs.writeFileSync(inv, JSON.stringify({ tool: 'inventory', pages: [
  { url: `${S}/footer-phone/`, status: 200, redirectHops: 0, contentType: 'text/html', canonicalisedTo: null },
  { url: `${S}/moved/`, status: 200, redirectHops: 1, contentType: 'text/html', canonicalisedTo: null },
  { url: `${S}/gone/`, status: 404, redirectHops: 0, contentType: 'text/html', canonicalisedTo: null },
] }));
const d = await run(['--from-inventory', inv, '--delay', '0', '--format', 'json'], tmp);
test('inventory input: only 200 HTML pages without redirect', () => assert(d.json && d.json.pages.length === 1 && d.json.pages[0].url === `${S}/footer-phone/`, JSON.stringify(d.json?.pages)));
test('data folder: brand auto-detected, report written', () => {
  assert(d.json.brand?.name === 'Muster Werkstatt GmbH', JSON.stringify(d.json.brand));
  const dirs = fs.readdirSync(path.join(tmp, 'website-builder', 'reports'));
  assert(dirs.length === 1 && /^\d{4}-\d{2}-\d{2}-seo$/.test(dirs[0]), JSON.stringify(dirs));
  const out = path.join(tmp, 'website-builder', 'reports', dirs[0]);
  assert(fs.existsSync(path.join(out, 'report.md')) && fs.existsSync(path.join(out, 'seo-check.json')), fs.readdirSync(out).join(', '));
});
fs.rmSync(tmp, { recursive: true, force: true });

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
