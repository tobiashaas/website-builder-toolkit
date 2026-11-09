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

// Clean page inside a project with website-builder/: default report folder, screenshots, exit 0.
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'render-check-test-'));
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
