#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// Test runner for slop-lint: runs the CLI on fixtures and checks rule ids, counts and exit codes.
// Usage: node scripts/test/run.mjs

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lint = path.join(here, '..', 'slop-lint.mjs');
const fx = (p) => path.join(here, 'fixtures', p);
const brand = fx('brand.md');

function run(args, cwd = here) {
  const r = spawnSync(process.execPath, [lint, ...args, '--format', 'json'], { cwd, encoding: 'utf8' });
  if (r.status === 2 || !r.stdout) throw new Error(`CLI failed (${r.status}): ${r.stderr}`);
  return { ...JSON.parse(r.stdout), status: r.status };
}

const cases = [
  { name: 'html tells', args: [fx('tells/landing.html')], status: 1,
    expect: ['a11y/zoom-disabled', 'a11y/img-alt', 'a11y/outline-none', 'a11y/vague-link-text', 'design/gradient-text',
      'design/ai-gradient', 'design/glow-shadow', 'design/hover-scale', 'design/infinite-animation', 'design/heavy-weight',
      'design/uppercase-tracking', 'design/decorative-dashed-border', 'css/transition-all', 'copy/hype-word',
      'copy/soft-hype-word', 'copy/emoji-in-ui', 'copy/sparkle-emoji', 'copy/exclamation', 'copy/greeting-headline',
      'copy/placeholder-content', 'copy/unsourced-social-proof', 'copy/change-without-reference', 'copy/button-period'],
    count: { 'a11y/img-alt': 1 } },
  { name: 'css tells', args: [fx('tells/components.css')],
    expect: ['design/ai-gradient', 'design/glow-shadow', 'css/transition-all', 'design/negative-tracking-small',
      'css/animate-layout', 'css/important-overuse', 'css/px-sprawl'],
    absent: ['design/infinite-animation'] },
  { name: 'jsx/tailwind tells, no adapter', args: [fx('tells/app.jsx')],
    expect: ['design/gradient-text', 'design/ai-gradient', 'design/hover-scale', 'css/transition-all', 'design/glow-shadow',
      'design/infinite-animation', 'design/heavy-weight', 'design/uppercase-tracking', 'css/arbitrary-px', 'a11y/outline-none',
      'copy/hype-word', 'copy/exclamation'],
    absent: ['tailwind/shadow-2xl'], count: { 'design/infinite-animation': 1 } },
  { name: 'jsx with --adapter tailwind', args: [fx('tells/app.jsx'), '--adapter', 'tailwind'],
    expect: ['tailwind/purple-gradient', 'tailwind/rounded-overuse', 'tailwind/shadow-2xl', 'tailwind/arbitrary-value', 'tailwind/uppercase-tracking'],
    absent: ['css/arbitrary-px', 'design/uppercase-tracking', 'design/ai-gradient'] },
  { name: 'markdown tells', args: [fx('tells/readme.md')],
    expect: ['copy/emoji-in-ui', 'copy/hype-word', 'copy/ai-phrase', 'copy/unsourced-social-proof', 'copy/placeholder-content',
      'a11y/vague-link-text', 'a11y/img-alt'],
    absent: ['css/transition-all'], count: { 'a11y/vague-link-text': 2 } },
  { name: 'markdown fenced code with --md-code', args: [fx('tells/readme.md'), '--md-code'], expect: ['css/transition-all'] },
  { name: 'json copy', args: [fx('tells/strings.json')], expect: ['copy/hype-word', 'copy/exclamation', 'copy/button-period'],
    count: { 'copy/hype-word': 2 } },
  { name: 'german copy without brand (auto lang)', args: [fx('tells/angebot-de.md')],
    expect: ['copy/ai-phrase', 'copy/hype-word', 'copy/soft-hype-word', 'copy/unsourced-social-proof', 'copy/de-straight-quotes',
      'copy/placeholder-content', 'copy/greeting-headline', 'a11y/vague-link-text'],
    absent: ['brand/address-du', 'brand/gendering'], count: { 'copy/ai-phrase': 2 } },
  { name: 'german copy with brand', args: [fx('tells/angebot-de.md'), '--brand', brand, '--lang', 'de'],
    expect: ['brand/address-du', 'brand/gendering', 'brand/banned-word', 'brand/banned-phrase', 'brand/claim-never'],
    count: { 'brand/gendering': 2 } },
  { name: '--lang en disables German rules', args: [fx('tells/angebot-de.md'), '--brand', brand, '--lang', 'en'],
    absent: ['copy/de-straight-quotes', 'brand/address-du'], expect: ['brand/gendering', 'brand/banned-word'] },
  { name: 'brand css: palette, fonts, motion none', args: [fx('tells/brand.css'), '--brand', brand],
    expect: ['brand/off-palette-color', 'brand/off-brand-font', 'brand/motion-none'],
    count: { 'brand/off-palette-color': 1, 'brand/off-brand-font': 1 } },
  { name: 'acss adapter', args: [fx('tells/acss.css'), '--adapter', 'acss'],
    expect: ['acss/raw-px', 'acss/hardcoded-hex', 'acss/bg-var-in-class', 'acss/max-width-media'],
    count: { 'acss/raw-px': 1, 'acss/hardcoded-hex': 1 } },
  { name: 'acss rules off without adapter', args: [fx('tells/acss.css')], absent: ['acss/raw-px', 'acss/hardcoded-hex'] },
  { name: 'inline disable comments', args: [fx('tells/ignored.css')],
    count: { 'css/transition-all': 1 }, absent: ['design/heavy-weight', 'design/glow-shadow'] },
  { name: 'config file: overrides, ignore globs, thresholds', args: ['.'], cwd: fx('config'), status: 1,
    expect: ['css/transition-all', 'css/px-sprawl'], absent: ['design/heavy-weight'],
    check: (r) => r.findings.every((x) => !x.file.startsWith('skip/')) && r.findings.find((x) => x.rule === 'css/transition-all').severity === 'error' },
  { name: '--fail-on warn', args: [fx('tells/components.css'), '--fail-on', 'warn'], status: 1 },
  { name: 'button period: only real buttons, never headings or wrappers', args: [fx('tells/buttons.html'), '--lang', 'de'], count: { 'copy/button-period': 3 } },
  { name: 'clean fixtures: zero findings', args: [fx('clean')], status: 0, total: 0 },
  { name: 'clean fixtures with brand + adapters: zero errors', args: [fx('clean'), '--brand', brand, '--adapter', 'tailwind'], status: 0, errors: 0 },
  { name: 'clean German file with brand', args: [fx('clean/termine-de.md'), '--brand', brand], status: 0, total: 0 },
];

let failed = 0;
for (const c of cases) {
  const problems = [];
  let r;
  try { r = run(c.args, c.cwd); } catch (e) { problems.push(e.message); }
  if (r) {
    const ids = r.findings.map((x) => x.rule);
    for (const id of c.expect || []) if (!ids.includes(id)) problems.push(`missing ${id}`);
    for (const id of c.absent || []) if (ids.includes(id)) problems.push(`unexpected ${id}`);
    for (const [id, n] of Object.entries(c.count || {})) {
      const got = ids.filter((x) => x === id).length;
      if (got !== n) problems.push(`${id}: expected ${n}, got ${got}`);
    }
    if (c.status !== undefined && r.status !== c.status) problems.push(`exit ${r.status}, expected ${c.status}`);
    if (c.total !== undefined && r.findings.length !== c.total) problems.push(`expected ${c.total} findings, got ${r.findings.length}: ${ids.join(', ')}`);
    if (c.errors !== undefined && r.summary.error !== c.errors) problems.push(`expected ${c.errors} errors, got ${r.summary.error}`);
    if (c.check && !c.check(r)) problems.push('custom check failed');
  }
  if (problems.length) { failed++; console.log(`FAIL  ${c.name}\n      ${problems.join('\n      ')}`); }
  else console.log(`ok    ${c.name}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
