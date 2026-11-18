#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// Test runner for render-check.mjs: serves the fixture pages on a random local port,
// runs the CLI against them in the local Chrome and checks the findings and exit codes.
// Skips (exit 0) with a message when Chrome or Node 22+ is missing.
// Usage: node scripts/test/run.mjs

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'render-check.mjs');
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
const find = (r, pred) => (r.json ? r.json.findings.filter(pred) : []);
const has = (r, pred, msg) => assert(find(r, pred).length > 0, `${msg}\n      findings: ${JSON.stringify(r.json?.findings?.map((f) => [f.width, f.check, f.severity, f.selector]))}${r.stderr ? `\n      stderr: ${r.stderr}` : ''}`);
const none = (r, pred, msg) => { const hit = find(r, pred); assert(hit.length === 0, `${msg}: ${JSON.stringify(hit)}`); };

// ---------------- usage errors (no Chrome needed) ----------------
const usageNoUrl = await run([]);
test('no URL: exit 2', () => assert(usageNoUrl.status === 2 && /no URL/.test(usageNoUrl.stderr), `status ${usageNoUrl.status}, ${usageNoUrl.stderr}`));
const usageLevel = await run(['http://localhost/', '--level', 'x']);
test('bad --level: exit 2', () => assert(usageLevel.status === 2, `status ${usageLevel.status}`));
const usageWidths = await run(['http://localhost/', '--widths', '390,abc']);
test('bad --widths: exit 2', () => assert(usageWidths.status === 2, `status ${usageWidths.status}`));

// ---------------- fixture server ----------------
const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, 'http://x').pathname);
  const file = path.join(fixtures, name);
  if (name.endsWith('.html') && fs.existsSync(file)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(file)); }
  else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const common = ['--format', 'json', '--wait', '200', '--no-out'];

const bad = await run([`${base}/bad.html`, '--widths', '390,1280', ...common]);
if (bad.status === 2 && /Chrome not found|Node 22/.test(bad.stderr)) {
  console.log(`skip  browser tests: ${bad.stderr.trim()}`);
  server.close();
  console.log(`\n${passed} passed, ${failed} failed (browser tests skipped)`);
  process.exit(failed ? 1 : 0);
}

test('bad: exit 1, JSON parsed', () => assert(bad.status === 1 && bad.json, `status ${bad.status}, stderr ${bad.stderr}`));
test('bad: reflow error at 390', () => has(bad, (f) => f.width === 390 && f.check === 'reflow' && f.selector === 'html' && /in a 390 px viewport/.test(f.detail), 'no document overflow'));
test('bad: overflow offender is div.wide', () => has(bad, (f) => f.check === 'reflow' && /div\.wide$/.test(f.selector), 'div.wide not listed'));
test('bad: clipped slider not listed', () => none(bad, (f) => f.check === 'reflow' && /slide/.test(f.selector), 'slide listed'));
test('bad: no reflow at 1280', () => none(bad, (f) => f.check === 'reflow' && (f.width === 1280 || (f.alsoAt || []).includes(1280)), 'reflow at 1280'));
test('bad: low contrast is an error with the ratio', () => has(bad, (f) => f.check === 'contrast' && f.severity === 'error' && /p\.low$/.test(f.selector) && Math.abs(f.ratio - 2.32) < 0.02, 'p.low contrast missing'));
test('bad: low contrast next to an inline child is measured', () => has(bad, (f) => f.check === 'contrast' && f.severity === 'error' && /p\.low-mixed$/.test(f.selector), 'p.low-mixed contrast missing'));
test('bad: 4.54:1 passes AA', () => none(bad, (f) => f.check === 'contrast' && /p\.mid$/.test(f.selector), 'p.mid flagged at AA'));
test('bad: text over background image is manual', () => has(bad, (f) => f.check === 'contrast' && f.severity === 'manual' && /background-image on .*div\.photo/.test(f.detail), 'photo manual missing'));
test('bad: dark default text not flagged', () => none(bad, (f) => f.check === 'contrast' && f.severity === 'error' && /h1/.test(f.selector), 'h1 flagged'));
test('bad: gradient text warns', () => has(bad, (f) => f.check === 'gradient-text' && f.severity === 'warn' && /h2\.grad/.test(f.selector), 'gradient text missing'));
test('bad: infinite animation warns with name', () => has(bad, (f) => f.check === 'animation' && f.severity === 'warn' && /span\.spin/.test(f.selector) && /"spin"/.test(f.detail), 'animation missing'));
test('bad: img without alt is an error', () => has(bad, (f) => f.check === 'image-alt' && f.severity === 'error', 'image-alt missing'));
test('bad: img with alt not flagged', () => assert(find(bad, (f) => f.check === 'image-alt').length === 1, 'more than one image-alt finding'));
test('bad: icon-only button without name', () => has(bad, (f) => f.check === 'accessible-name' && /button\.icon-only/.test(f.selector), 'accessible-name missing'));
test('bad: tiny target warns', () => has(bad, (f) => f.check === 'target-size' && /a\.tiny/.test(f.selector) && /12 × 12/.test(f.detail), 'target-size missing'));
test('bad: inline link in text exempt', () => none(bad, (f) => f.check === 'target-size' && /p > a$/.test(f.selector), 'inline link flagged'));
test('bad: viewport meta user-scalable=no', () => has(bad, (f) => f.check === 'viewport-meta' && f.severity === 'error' && /user-scalable=no/.test(f.detail), 'user-scalable missing'));
test('bad: viewport meta maximum-scale=1', () => has(bad, (f) => f.check === 'viewport-meta' && /maximum-scale=1/.test(f.detail), 'maximum-scale missing'));
test('bad: exception reported', () => has(bad, (f) => f.check === 'console' && f.severity === 'warn' && /fixture boom/.test(f.detail), 'exception missing'));
test('bad: 404 request reported', () => has(bad, (f) => f.check === 'console' && /HTTP 404/.test(f.detail) && /missing\.png/.test(f.detail), '404 missing'));
test('bad: findings deduped across widths', () => has(bad, (f) => f.check === 'image-alt' && f.alsoAt.includes(1280), 'no alsoAt'));
test('bad: summary counts match', () => assert(bad.json.summary.error === bad.json.findings.filter((f) => f.severity === 'error').length, 'summary mismatch'));

const rm = await run([`${base}/bad.html`, '--widths', '390', '--reduced-motion', '--level', 'aaa', ...common]);
test('bad --level aaa: 4.54:1 fails 7:1', () => has(rm, (f) => f.check === 'contrast' && f.severity === 'error' && /p\.mid$/.test(f.selector) && /needs 7:1/.test(f.detail), 'p.mid not flagged at AAA'));
test('bad --reduced-motion: infinite spin is an error', () => has(rm, (f) => f.check === 'reduced-motion' && f.severity === 'error' && /span\.spin/.test(f.detail + f.selector), 'reduced-motion error missing'));

const motion = await run([`${base}/motion.html`, '--widths', '390', ...common]);
test('motion: both infinite animations warn', () => {
  has(motion, (f) => f.check === 'animation' && /div\.pulse/.test(f.selector), 'pulse missing');
  has(motion, (f) => f.check === 'animation' && /div\.always/.test(f.selector), 'always missing');
  assert(motion.status === 0, `status ${motion.status}`);
});
const motionRm = await run([`${base}/motion.html`, '--widths', '390', '--reduced-motion', ...common]);
test('motion --reduced-motion: guarded animation stops, unguarded is an error', () => {
  none(motionRm, (f) => /div\.pulse/.test(f.selector), 'pulse still reported');
  has(motionRm, (f) => f.check === 'reduced-motion' && /div\.always/.test(f.selector), 'always missing');
  assert(motionRm.status === 1, `status ${motionRm.status}`);
});

// Image priority: lazy hero image, too many high-priority images, and the correct setup.
const prio = await run([`${base}/priority.html`, '--widths', '390,1280', ...common]);
test('priority: lazy-loaded largest image in the first viewport is an error', () => has(prio, (f) => f.check === 'image-priority' && f.severity === 'error' && /loading="lazy"/.test(f.detail), 'lazy hero missing'));
test('priority: more than two fetchpriority="high" images is a warning', () => has(prio, (f) => f.check === 'image-priority' && f.severity === 'warn' && /^3 images/.test(f.detail), 'high count missing'));
test('priority: exit 1', () => assert(prio.status === 1, `status ${prio.status}`));
const prioOk = await run([`${base}/priority-ok.html`, '--widths', '390,1280', ...common]);
test('priority: high-priority hero and lazy image below the fold pass', () => none(prioOk, (f) => f.check === 'image-priority', 'image-priority flagged'));
const prioBad = find(bad, (f) => f.check === 'image-priority');
test('priority: small images are not treated as the hero', () => assert(prioBad.length === 0, JSON.stringify(prioBad)));

// CSS effect: declarations whose removal changes no computed style. Framework and core stylesheets are left out on their own.
const css = await run([`${base}/css-effect.html`, '--widths', '390,1280', '--css-effect', ...common]);
const noEffect = (prop, sel) => (f) => f.check === 'css-no-effect' && f.severity === 'warn' && f.selector.endsWith(`› ${sel}`) && f.detail.startsWith(`${prop}:`);
test('css-effect: value the framework already sets is reported', () => has(css, noEffect('font-size', 'h1'), 'h1 font-size missing'));
test('css-effect: browser default and inherited value are reported at both widths', () => {
  has(css, (f) => noEffect('display', '.box')(f) && f.width === 390 && f.alsoAt.includes(1280), 'display: block missing');
  has(css, noEffect('color', '.box'), 'inherited color missing');
});
test('css-effect: declaration that changes the render is not reported', () => {
  none(css, (f) => f.check === 'css-no-effect' && /^border:/.test(f.detail), 'border flagged');
  none(css, (f) => f.check === 'css-no-effect' && /^max-width:/.test(f.detail), 'max-width flagged');
});
test('css-effect: base padding has an effect at 390, the repeat in the media query has none', () => {
  const pad = find(css, (f) => f.check === 'css-no-effect' && /^padding:/.test(f.detail));
  assert(pad.length === 1 && pad[0].width === 1280 && pad[0].alsoAt.length === 0, JSON.stringify(pad));
});
test('css-effect: transition and :hover are not judged', () => none(css, (f) => f.check === 'css-no-effect' && (/^transition/.test(f.detail) || /:hover/.test(f.selector)), 'unchecked declaration flagged'));
test('css-effect: unmatched rules are one manual note', () => has(css, (f) => f.check === 'css-no-effect' && f.severity === 'manual' && /^1 rule\(s\) match nothing/.test(f.detail) && /\.ghost/.test(f.detail), 'unmatched note missing'));
test('css-effect: the framework stylesheet is left out and listed', () => {
  none(css, (f) => f.check === 'css-no-effect' && /automatic/.test(f.selector), 'framework sheet checked');
  assert(css.json.cssEffect.skipped.some((x) => /automatic-inline-css/.test(x)), JSON.stringify(css.json.cssEffect.skipped));
});
test('css-effect: summary in JSON, exit 0 (warnings only)', () => assert(css.status === 0 && css.json.cssEffect.noEffect === 4 && css.json.cssEffect.sheets.length === 1, `status ${css.status}, ${JSON.stringify(css.json.cssEffect)}`));
const cssNone = await run([`${base}/css-effect.html`, '--widths', '390', '--css-only', 'nothing-like-this', ...common]);
test('css-only: pattern without a match names the stylesheets on the page', () => has(cssNone, (f) => f.check === 'css-no-effect' && /no stylesheet matches/.test(f.detail) && /style#automatic-inline-css/.test(f.detail), 'no-match note missing'));
const cssOnly = await run([`${base}/css-effect.html`, '--widths', '390', '--css-only', 'automatic', ...common]);
test('css-only: a named stylesheet is checked even when it is a framework one', () => assert(cssOnly.json.cssEffect.sheets.length === 1 && /automatic/.test(cssOnly.json.cssEffect.sheets[0]) && cssOnly.json.cssEffect.tested > 0, JSON.stringify(cssOnly.json.cssEffect)));
const cssVendorOnly = await run([`${base}/clean.html`, '--widths', '390', '--css-effect', ...common]);
test('css-effect: summary is present on a page with its own stylesheet', () => assert(cssVendorOnly.json.cssEffect && cssVendorOnly.json.cssEffect.sheets.length >= 1, JSON.stringify(cssVendorOnly.json.cssEffect)));
test('css-effect: off by default', () => none(prioOk, (f) => f.check === 'css-no-effect', 'ran without the flag'));

// CSS effect, edge cases: anonymous style blocks, twin rules, var() shorthands, rules with many matches.
const edge = await run([`${base}/css-edge.html`, '--widths', '390', '--css-effect', ...common]);
const edgeCss = find(edge, (f) => f.check === 'css-no-effect');
test('css-edge: two anonymous <style> blocks are kept apart', () => {
  assert(edge.json.cssEffect.sheets.length === 2 && edge.json.cssEffect.sheets[1] === '<style> (2)', JSON.stringify(edge.json.cssEffect.sheets));
  assert(edgeCss.some((f) => f.selector === '<style> (2) › body' && /^color:/.test(f.detail)), 'body color in the second block missing');
});
test('css-edge: twin rules are both reported and name each other', () => {
  const twins = edgeCss.filter((f) => f.selector.endsWith('› .twin'));
  assert(twins.length === 2 && twins.every((f) => /the same declaration is also in <style>/.test(f.detail)), JSON.stringify(twins));
});
test('css-edge: a rule that one of many matched elements depends on is not reported', () => {
  assert(!edgeCss.some((f) => f.selector.endsWith('› li')), 'li flagged although the list outside nav needs it');
  assert(edgeCss.some((f) => f.selector.endsWith('› nav li')), 'nav li (covered by li) missing');
});
test('css-edge: shorthand with var() next to its longhand is left untouched', () => {
  assert(!edgeCss.some((f) => f.selector.endsWith('› .var')), 'var() rule judged');
  assert(!edgeCss.some((f) => /could not be restored/.test(f.detail)), 'page altered by the probe');
  assert(edge.json.cssEffect.unchecked >= 1, JSON.stringify(edge.json.cssEffect));
});

test('css-edge: nested rules are judged with their resolved selector', () => {
  assert(edgeCss.some((f) => f.selector.endsWith('› :is(.card) .card__text') && /^color:/.test(f.detail)), `nested color missing: ${JSON.stringify(edgeCss.map((f) => [f.selector, f.detail.slice(0, 30)]))}`);
  assert(!edgeCss.some((f) => /card__title/.test(f.selector)), 'nested declarations with an effect flagged');
  assert(!edgeCss.some((f) => /card__text/.test(f.selector) && /^margin:/.test(f.detail)), 'nested margin flagged');
});

// Style position: measured on the render against a direction file.
const dirFile = (n) => path.join(fixtures, n);
const sp = (r) => find(r, (f) => f.check === 'style-position');
const styleOk = await run([`${base}/style.html`, '--widths', '390,1280', '--direction', dirFile('direction-match.md'), ...common]);
test('style: a page inside its confirmed position has no style findings', () => assert(sp(styleOk).length === 0 && styleOk.json.style.shape === 'round', JSON.stringify(sp(styleOk))));
const styleOff = await run([`${base}/style.html`, '--widths', '390,1280', '--direction', dirFile('direction-off.md'), ...common]);
test('style: shape above the stage is reported for control and card', () => {
  assert(sp(styleOff).some((f) => /button\.button/.test(f.selector) && /corner radius 14 px with shape "sharp"/.test(f.detail)), JSON.stringify(sp(styleOff)));
  assert(sp(styleOff).some((f) => /div\.card/.test(f.selector) && /corner radius 14 px/.test(f.detail)), 'card missing');
});
test('style: type contrast and density are judged at the reference width only', () => {
  const type = sp(styleOff).filter((f) => /largest font size 72 px is 4\.5 times body size/.test(f.detail));
  const dens = sp(styleOff).filter((f) => /median section padding 120 px over 3 section\(s\) with density "dense"/.test(f.detail));
  assert(type.length === 1 && type[0].width === 1280 && dens.length === 1 && dens[0].width === 1280, JSON.stringify(sp(styleOff).map((f) => [f.width, f.detail.slice(0, 60)])));
});
test('style: color budget counts hue families', () => assert(sp(styleOff).some((f) => f.selector === 'colors' && /^2 hue families besides neutrals with color budget "one-accent"/.test(f.detail)), JSON.stringify(sp(styleOff).map((f) => f.detail.slice(0, 70)))));
test('style: an image in the first viewport breaks type-only', () => assert(sp(styleOff).some((f) => /img\.hero-image/.test(f.selector) && /with imagery "type-only"/.test(f.detail)), 'imagery missing'));
test('style: findings are warnings, exit 0', () => assert(styleOff.status === 0 && sp(styleOff).every((f) => f.severity === 'warn'), `status ${styleOff.status}`));
const styleBad = await run(['http://localhost/', '--direction', dirFile('direction-invalid.md')]);
test('style: unknown stage is a usage error', () => assert(styleBad.status === 2 && /style\.shape: "pointy"/.test(styleBad.stderr), `status ${styleBad.status} ${styleBad.stderr}`));
test('style: off without --direction', () => assert(sp(prioOk).length === 0, 'ran without the flag'));

// A page that opens an alert must not hang; an error status of the document is an error.
const dialog = await run([`${base}/dialog.html`, '--widths', '390', ...common]);
test('dialog: alert is dismissed and reported, the run finishes', () => has(dialog, (f) => f.check === 'console' && f.selector === 'dialog' && /alert dialog dismissed/.test(f.detail), 'dialog note missing'));
const gone = await run([`${base}/missing.html`, '--widths', '390', ...common]);
test('status: a document answering 404 is an error', () => { has(gone, (f) => f.check === 'load' && f.severity === 'error' && /HTTP 404/.test(f.detail), 'status error missing'); assert(gone.status === 1, `status ${gone.status}`); });

// Clean page inside a project with website-builder/: default report folder, screenshots, exit 0.
// realpath: on macOS os.tmpdir() sits behind a symlink and the CLI reports the resolved path.
const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'render-check-test-')));
fs.mkdirSync(path.join(proj, 'website-builder'));
const clean = await run([`${base}/clean.html`, '--widths', '390,1440', '--wait', '200']); // text format, default --out
const outDir = path.join(proj, 'website-builder', 'reports', `${new Date().toISOString().slice(0, 10)}-127-0-0-1-clean-render`);
const cleanInProj = await run([`${base}/clean.html`, '--widths', '390,1440', '--wait', '200', '--format', 'json'], proj);
test('clean: exit 0, no errors, warnings or manual checks', () => {
  assert(cleanInProj.status === 0, `status ${cleanInProj.status} ${cleanInProj.stderr}`);
  assert(cleanInProj.json.findings.length === 0, `findings: ${JSON.stringify(cleanInProj.json.findings)}`);
});
test('clean: report.md and screenshots in website-builder/reports/<date>-<slug>-render/', () => {
  assert(cleanInProj.json.outDir === outDir, `outDir ${cleanInProj.json.outDir}`);
  for (const f of ['report.md', '390.png', '1440.png']) assert(fs.existsSync(path.join(outDir, f)), `${f} missing`);
  const md = fs.readFileSync(path.join(outDir, 'report.md'), 'utf8');
  assert(/^# Render check: /.test(md) && /No findings\./.test(md), 'report.md content');
  const png = fs.readFileSync(path.join(outDir, '390.png'));
  assert(png.readUInt32BE(16) === 390, `390.png is ${png.readUInt32BE(16)} px wide`);
});
test('clean: text format without data folder writes nothing and prints summary', () => {
  assert(clean.status === 0, `status ${clean.status} ${clean.stderr}`);
  assert(/390 px  no findings/.test(clean.stdout) && /render-check: 0 error\(s\), 0 warning\(s\), 0 manual check\(s\) at 2 width\(s\)/.test(clean.stdout), clean.stdout);
  assert(!/report and screenshots/.test(clean.stdout), 'wrote files without a data folder');
});
fs.rmSync(proj, { recursive: true, force: true });

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
