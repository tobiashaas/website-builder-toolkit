#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// Test runner for contrast.mjs: runs the CLI on known pairs and brand fixtures,
// checks ratios, pass/fail, suggestions, APCA values and exit codes.
// Usage: node scripts/test/run.mjs

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'contrast.mjs');
const fx = (p) => path.join(here, 'fixtures', p);

function run(args, cwd = here) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  let json = null;
  if (args.includes('--format') && r.stdout) json = JSON.parse(r.stdout);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
const pair = (fg, bg, ...extra) => run([fg, ...(bg ? [bg] : []), ...extra, '--format', 'json']);
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------- known pairs ----------------
const known = [
  ['#000', '#fff', 21, 0],
  ['#000000', '#ffffff', 21, 0],
  ['#777', '#fff', 4.48, 1],         // the classic near miss
  ['#767676', '#fff', 4.54, 0],      // lightest grey that passes AA on white
  ['#292929', '#ffffff', 14.55, 0],
  ['#ffffff', '#292929', 14.55, 0],  // order does not matter for the ratio
  ['#fff', '#fff', 1, 1],
  ['#f00', '#fff', 4.0, 1],
  ['#0000ff', '#ffffff', 8.59, 0],
];
for (const [fg, bg, want, status] of known) {
  test(`${fg} on ${bg} = ${want}:1`, () => {
    const r = pair(fg, bg);
    const res = r.json.results[0];
    assert(near(res.ratio, want), `ratio ${res.ratio}`);
    assert(r.status === status, `exit ${r.status}, want ${status}`);
  });
}

test('#777 on #fff: AA large and UI pass, AA normal fails, display not rounded up', () => {
  const res = pair('#777', '#fff').json.results[0];
  assert(res.checks.aaLarge && res.checks.ui && !res.checks.aaNormal && !res.checks.aaaNormal, JSON.stringify(res.checks));
  assert(res.ratioText === '4.48', res.ratioText);
});

test('a ratio just under 4.5 is never printed as 4.50', () => {
  // #767776 on #fff is about 4.496:1: rounding to 2 decimals would read as a pass.
  const res = pair('#767776', '#fff').json.results[0];
  assert(!res.checks.aaNormal, `raw ${res.ratio} should fail`);
  assert(res.ratioText !== '4.50' && parseFloat(res.ratioText) < 4.5, res.ratioText);
});

// ---------------- color syntax ----------------
const same = [
  ['#292929', '#292929ff'],
  ['#abc', '#aabbcc'],
  ['#abcf', '#aabbcc'],
  ['rgb(41, 41, 41)', '#292929'],
  ['rgb(41 41 41)', '#292929'],
  ['rgba(41,41,41,1)', '#292929'],
  ['rgb(100% 0% 0%)', '#ff0000'],
  ['hsl(0, 100%, 50%)', '#ff0000'],
  ['hsl(120deg 100% 25%)', 'rgb(0 127.5 0)'],
  ['hsl(0.5turn 100% 50%)', '#00ffff'],
  ['hsla(240, 100%, 50%, 1)', '#0000ff'],
  ['white', '#ffffff'],
];
for (const [a, b] of same) {
  test(`parse ${a}`, () => {
    const ra = pair(a, '#fff').json.results[0].ratio;
    const rb = pair(b, '#fff').json.results[0].ratio;
    assert(near(ra, rb, 0.02), `${ra} vs ${rb}`);
  });
}

// ---------------- alpha compositing ----------------
test('rgba(0,0,0,.5) over #fff composites to mid grey (~3.95-4.0:1)', () => {
  const res = pair('rgba(0,0,0,.5)', '#fff').json.results[0];
  assert(res.composited && res.fgHex === '#808080', res.fgHex);
  assert(res.ratio > 3.9 && res.ratio < 4.0, `${res.ratio}`);
});
test('#00000080 equals rgb(0 0 0 / 50%) within 8-bit alpha precision', () => {
  const a = pair('#00000080', '#fff').json.results[0].ratio;
  const b = pair('rgb(0 0 0 / 50%)', '#fff').json.results[0].ratio;
  assert(near(a, b, 0.03), `${a} vs ${b}`);
});
test('single color uses --bg as background', () => {
  const res = pair('rgba(255,255,255,.9)', null, '--bg', '#000').json.results[0];
  assert(res.bgHex === '#000000' && res.fgHex === '#e6e6e6', `${res.fgHex} on ${res.bgHex}`);
});
test('translucent background is composited over --bg first', () => {
  const res = pair('#000', 'rgba(255,255,255,.5)', '--bg', '#000').json.results[0];
  assert(res.bgHex === '#808080', res.bgHex);
});

// ---------------- kind and level ----------------
test('--kind ui: red on white passes 3:1', () => {
  const r = pair('#f00', '#fff', '--kind', 'ui');
  assert(r.status === 0 && r.json.results[0].required.min === 3, `exit ${r.status}`);
});
test('--kind large --level aaa: #767676 on #fff passes 4.5:1', () => {
  const r = pair('#767676', '#fff', '--kind', 'large', '--level', 'aaa');
  assert(r.status === 0 && r.json.results[0].required.check === 'aaaLarge', `exit ${r.status}`);
});
test('--level aaa: #767676 on #fff fails 7:1', () => {
  assert(pair('#767676', '#fff', '--level', 'aaa').status === 1, 'should fail');
});

// ---------------- suggestions ----------------
test('--suggest #777 on #fff proposes a darker passing shade', () => {
  const res = pair('#777', '#fff', '--suggest').json.results[0];
  const d = res.suggestions.aa.darker;
  assert(d && d.ratio >= 4.5, JSON.stringify(res.suggestions));
  const check = pair(d.hex, '#fff').json.results[0];
  assert(check.ratio >= 4.5, `suggested ${d.hex} re-checks at ${check.ratio}`);
  assert(!res.suggestions.aa.lighter, 'nothing lighter can pass on white');
});
test('--suggest --level aaa adds an AAA shade that keeps the hue', () => {
  const res = pair('#1e7a4a', '#ffffff', '--suggest', '--level', 'aaa').json.results[0];
  const s = res.suggestions.aaa.darker;
  assert(s && s.ratio >= 7, JSON.stringify(res.suggestions));
  const hex = s.hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert(g > r && g > b, `hue drifted: ${s.hex}`);
});
test('--suggest on a dark surface proposes a lighter shade', () => {
  const res = pair('#555555', '#1a1a1a', '--suggest').json.results[0];
  assert(res.suggestions.aa.lighter && res.suggestions.aa.lighter.ratio >= 4.5, JSON.stringify(res.suggestions));
});
test('passing pairs carry no suggestions', () => {
  assert(!pair('#000', '#fff', '--suggest').json.results[0].suggestions, 'unexpected suggestions');
});

// ---------------- APCA (reference values from apca-w3 0.1.9, 0.0.98G-4g) ----------------
const apca = [['#888888', '#ffffff', 63.1], ['#ffffff', '#888888', -68.5], ['#000000', '#ffffff', 106.0], ['#ffffff', '#000000', -107.9], ['#1e4d3a', '#e8dcc4', 72.2]];
for (const [t, b, lc] of apca) {
  test(`APCA ${t} on ${b} = Lc ${lc}`, () => {
    const res = pair(t, b, '--apca').json.results[0];
    assert(near(res.apcaLc, lc, 0.11), `Lc ${res.apcaLc}`);
  });
}
test('APCA is labelled informational in text output', () => {
  const r = run(['#000', '#fff', '--apca']);
  assert(/informational/.test(r.stdout) && /not a WCAG 2\.2 requirement/.test(r.stdout), r.stdout);
});

// ---------------- brand matrix ----------------
test('brand fixture: text and accent roles on surfaces, 4 of 8 fail', () => {
  const r = run(['--brand', fx('brand.md'), '--format', 'json']);
  assert(r.status === 1, `exit ${r.status}`);
  assert(r.json.mode === 'roles' && r.json.summary.checked === 8 && r.json.summary.failed === 4, JSON.stringify(r.json.summary));
  const fails = r.json.results.filter((x) => !x.pass).map((x) => `${x.fg}/${x.bg}`).sort();
  assert(fails.join() === ['Mint/Sand', 'Mint/White', 'Muted/Sand', 'Muted/White'].join(), fails.join());
  const tanne = r.json.results.find((x) => x.fg === 'Tanne' && x.bg === 'Sand');
  assert(tanne.kind === 'ui' && tanne.required.min === 3, JSON.stringify(tanne.required));
});
test('brand fixture with --suggest suggests for every failing pair', () => {
  const r = run(['--brand', fx('brand.md'), '--suggest', '--format', 'json']);
  assert(r.json.results.filter((x) => !x.pass).every((x) => x.suggestions?.aa), 'missing suggestion');
});
test('brand contrast: aaa sets the default level; --level aa overrides it', () => {
  const r = run(['--brand', fx('brand-aaa.md'), '--format', 'json']);
  assert(r.json.level === 'aaa' && r.json.results[0].required.min === 7 && r.status === 0, JSON.stringify(r.json.results[0].required));
  const o = run(['--brand', fx('brand-aaa.md'), '--level', 'aa', '--format', 'json']);
  assert(o.json.level === 'aa', o.json.level);
});
test('brand without roles falls back to all pairs', () => {
  const r = run(['--brand', fx('brand-noroles.md'), '--format', 'json']);
  assert(r.json.mode === 'all-pairs' && r.json.summary.checked === 3 && r.json.summary.failed === 1, JSON.stringify(r.json.summary));
  assert(r.status === 1, `exit ${r.status}`);
});
test('auto-detects website-builder/brand.md in a parent folder', () => {
  const r = run(['--format', 'json'], fx('project/sub'));
  assert(r.status === 0 && /project[\\/]website-builder[\\/]brand\.md$/.test(r.json.brand), r.stderr || r.json.brand);
});
test('setup.md with brand: none disables auto-detection', () => {
  const r = run([], fx('none'));
  assert(r.status === 2 && /no website-builder\/brand\.md/.test(r.stderr), r.stderr);
});
test('text matrix output names pairs and summary', () => {
  const r = run(['--brand', fx('brand.md')]);
  assert(/FAIL\s+Muted on Sand/.test(r.stdout) && /4 of 8 pair\(s\) fail AA/.test(r.stdout), r.stdout);
});

// ---------------- usage errors ----------------
for (const args of [['#zzz', '#fff'], ['#000', '#fff', '--level', 'a'], ['#000', '--kind', 'huge'], ['--nope'], ['#000', '#fff', '#111']]) {
  test(`usage error: ${args.join(' ')}`, () => {
    assert(run(args).status === 2, 'want exit 2');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
